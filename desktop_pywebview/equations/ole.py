"""Bounded Equation Native stream extraction from OLE compound files."""

import struct


SIGNATURE = bytes.fromhex('d0cf11e0a1b11ae1')
FREE, END = 0xffffffff, 0xfffffffe


def extract(data):
    def u16(offset):
        return struct.unpack_from('<H', data, offset)[0]
    def u32(offset):
        return struct.unpack_from('<I', data, offset)[0]
    if len(data) < 512:
        raise ValueError('OLE compound file: truncated header')
    if u16(28) != 0xfffe or u16(30) not in (9, 12) or u16(32) != 6:
        raise ValueError('OLE compound file: unsupported sector format')
    size = 1 << u16(30)
    count = len(data) // size - 1
    def sector(index):
        if not 0 <= index < count:
            raise ValueError('OLE compound file: sector out of range')
        return data[(index + 1) * size:(index + 2) * size]
    def words(raw):
        return [v[0] for v in struct.iter_unpack('<I', raw)]
    fat_count = u32(44)
    if not 0 < fat_count <= count:
        raise ValueError('OLE compound file: invalid FAT count')
    fat_sectors = [v for v in words(data[76:512]) if v != FREE][:fat_count]
    difat, seen = u32(68), set()
    for _ in range(min(u32(72), count)):
        if len(fat_sectors) == fat_count:
            break
        if difat in seen:
            raise ValueError('OLE compound file: invalid DIFAT chain')
        seen.add(difat)
        values = words(sector(difat))
        fat_sectors.extend(v for v in values[:-1] if v != FREE)
        difat = values[-1]
    if len(fat_sectors) != fat_count:
        raise ValueError('OLE compound file: incomplete FAT list')
    fat = [v for index in fat_sectors for v in words(sector(index))]
    def chain(start, allocation, unit, read):
        chunks, seen = [], set()
        while start != END:
            if not 0 <= start < len(allocation) or start in seen or len(seen) >= len(data) // unit:
                raise ValueError('OLE compound file: invalid sector chain')
            seen.add(start)
            chunks.append(read(start))
            start = allocation[start]
        return b''.join(chunks)
    def regular(start):
        return chain(start, fat, size, sector)
    directory = regular(u32(48))
    root = target = None
    for offset in range(0, len(directory) - 127, 128):
        entry = directory[offset:offset + 128]
        length = struct.unpack_from('<H', entry, 64)[0]
        if not 2 <= length <= 64:
            continue
        name = entry[:length - 2].decode('utf-16-le', errors='replace')
        start, length = struct.unpack_from('<II', entry, 116)
        if entry[66] == 5:
            root = start, length
        elif entry[66] == 2 and name in ('Equation Native', 'EquationNative', 'Equation'):
            target = start, length
    if target is None:
        raise ValueError('OLE compound file: equation stream not found')
    start, length = target
    if length > len(data):
        raise ValueError('OLE compound file: invalid stream size')
    if length >= u32(56):
        result = regular(start)
    else:
        if root is None:
            raise ValueError('OLE compound file: root stream not found')
        mini_stream = regular(root[0])
        mini_fat = words(regular(u32(60)))
        def mini_sector(index):
            if (index + 1) * 64 > len(mini_stream):
                raise ValueError('OLE compound file: mini sector out of range')
            return mini_stream[index * 64:(index + 1) * 64]
        result = chain(start, mini_fat, 64, mini_sector)
    if len(result) < length:
        raise ValueError('OLE compound file: truncated equation stream')
    return result[:length]
