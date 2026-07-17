import { describe, expect, it } from 'vitest'
import type { Device } from 'node-hid'
import { xinputModeHint } from '../src/doctor.js'

function device(overrides: Partial<Device>): Device {
  return {
    vendorId: 0,
    productId: 0,
    path: 'path',
    release: 0,
    interface: 0,
    usagePage: 0x01,
    usage: 0x05,
    ...overrides,
  } as Device
}

const stub = (vendorId: number): Device =>
  device({ vendorId, path: '\\\\?\\HID#VID_0000&PID_0000&IG_00#c&0&0#{4d1e55b2}' })

describe('xinputModeHint', () => {
  it('tells an 8BitDo pad in XInput mode how to switch to DInput', () => {
    expect(xinputModeHint([stub(0x2dc8)])).toMatch(/hold B while powering on/)
  })

  it('explains that other XInput-only pads are unreadable on Windows', () => {
    expect(xinputModeHint([stub(0x045e)])).toMatch(/XInput/)
    expect(xinputModeHint([stub(0x045e)])).not.toMatch(/hold B/)
  })

  it('stays quiet when a readable gamepad is present', () => {
    expect(xinputModeHint([stub(0x2dc8), device({ vendorId: 0x2dc8, productId: 0x6012 })])).toBe(
      null,
    )
    expect(xinputModeHint([device({ vendorId: 0x1234 })])).toBe(null)
    expect(xinputModeHint([])).toBe(null)
  })
})
