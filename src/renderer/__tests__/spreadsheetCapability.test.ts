import { describe, expect, it, vi } from 'vitest'
import { createUniverSpreadsheetCapability } from '../services/spreadsheetCapability'

describe('spreadsheet capability', () => {
  it('focuses a range with the same sheet switch and scroll used by Block and Region', () => {
    const setActiveSheet = vi.fn()
    const sheet: { scrollToCell: ReturnType<typeof vi.fn>; getSheetName: () => string } = {
      getSheetName: () => 'Products',
      scrollToCell: vi.fn(),
    }
    sheet.scrollToCell.mockReturnValue(sheet)
    const capability = createUniverSpreadsheetCapability({
      getActiveWorkbook: () => ({
        getSheetByName: (name: string) => name === 'Products' ? sheet : null,
        getActiveSheet: () => sheet,
        setActiveSheet,
        getSheets: () => [sheet],
      }),
    })

    expect(capability.focusRange('Products', {
      startRow: 20,
      startCol: 4,
      endRow: 20,
      endCol: 4,
      a1Notation: 'E21',
    })).toBe(true)
    expect(setActiveSheet).toHaveBeenCalledWith('Products')
    expect(sheet.scrollToCell).toHaveBeenCalledWith(17, 3)
  })
})
