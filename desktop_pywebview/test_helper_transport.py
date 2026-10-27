from concurrent.futures import Future, ThreadPoolExecutor
import json
import queue
import threading
import time
from types import SimpleNamespace
import unittest

from .helper import NativeHelper


class HelperTransportTests(unittest.TestCase):
    def attach_transport(self, replies, write, flush):
        exit_code = []
        def terminate():
            exit_code.append(0)
            replies.put(b'')
        helper = NativeHelper()
        def send(encoded):
            if json.loads(encoded).get('method') == 'close':
                terminate()
            else:
                write(encoded)
                flush()
        helper._connection = SimpleNamespace(send_bytes=send, recv_bytes=lambda _: replies.get(timeout=5), close=lambda: None)
        helper._process = SimpleNamespace(is_alive=lambda: not exit_code, terminate=terminate,
                                          kill=terminate, join=lambda *args: None)
        helper._reader = threading.Thread(target=helper._read_responses, daemon=True)
        helper._reader.start()
        self.addCleanup(helper.close)
        return helper

    def test_blocked_write_does_not_block_previous_response_dispatch(self):
        replies = queue.Queue()
        dispatched = threading.Event()
        previous = Future()
        previous.add_done_callback(lambda _: dispatched.set())
        current = []

        def write(encoded):
            current.append(json.loads(encoded))
            replies.put(b'{"id":1,"value":"previous"}\n')
            if not dispatched.wait(0.5):
                raise RuntimeError('Request write blocked response dispatch')
            return len(encoded)

        def flush():
            replies.put((json.dumps({'id': current[-1]['id'], 'value': 'current'}) + '\n').encode())

        helper = self.attach_transport(replies, write, flush)
        helper._counter = 1
        helper._pending[1] = previous
        self.assertEqual(helper.request('hello'), 'current')
        self.assertEqual(previous.result(timeout=1), 'previous')

    def test_concurrent_messages_stay_serialized_and_responses_match(self):
        replies = queue.Queue()
        messages = []
        state = {'active': 0, 'peak': 0}
        lock = threading.Lock()
        def write(encoded):
            with lock:
                state['active'] += 1
                state['peak'] = max(state['peak'], state['active'])
            time.sleep(0.002)
            messages.append(json.loads(encoded))
            with lock:
                state['active'] -= 1
            return len(encoded)
        def flush():
            request = messages[-1]
            replies.put((json.dumps({'id': request['id'], 'value': request['token']}) + '\n').encode())
        helper = self.attach_transport(replies, write, flush)
        with ThreadPoolExecutor(max_workers=8) as executor:
            results = [executor.submit(helper.request, 'hello', token=index) for index in range(24)]
            self.assertEqual([result.result(timeout=5) for result in results], list(range(24)))
        self.assertEqual(state['peak'], 1)
        self.assertEqual(len({message['id'] for message in messages}), 24)
