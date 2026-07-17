import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device } from 'node-hid'

// Mock node-hid so createDriver's enumeration is controllable without hardware.
const mockDevices = vi.fn<() => Device[]>(() => [])
vi.mock('node-hid', () => ({
  devices: (): Device[] => mockDevices(),
  HID: class {},
}))

const { createDriver } = await import('../src/controller/hid-manager.js')

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

beforeEach(() => {
  mockDevices.mockReturnValue([])
})

describe('createDriver routing', () => {
  it('routes the 8BitDo Ultimate 2 Wireless (DInput mode) to the 8bitdo driver', () => {
    mockDevices.mockReturnValue([device({ vendorId: 0x2dc8, productId: 0x6012 })])
    expect(createDriver()?.controllerType).toBe('8bitdo')
  })

  it('never claims a Windows XInput HID stub (IG_ path) — its reads always fail', () => {
    mockDevices.mockReturnValue([
      device({
        vendorId: 0x2dc8,
        productId: 0x310b,
        path: '\\\\?\\HID#VID_2DC8&PID_310B&IG_00#c&2b4999b7&0&0000#{4d1e55b2}',
      }),
    ])
    expect(createDriver()).toBeNull()
  })

  it('still claims an unknown pad with a readable path via the generic driver', () => {
    mockDevices.mockReturnValue([device({ vendorId: 0x1234, productId: 0x5678 })])
    expect(createDriver()?.controllerType).toBe('generic-hid')
  })

  it('returns null when nothing gamepad-like is present', () => {
    mockDevices.mockReturnValue([device({ usagePage: 0x01, usage: 0x06 })])
    expect(createDriver()).toBeNull()
  })
})
