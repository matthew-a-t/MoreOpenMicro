// 8BitDo Ultimate 2 Wireless for PC report parsing (DInput mode, report 0x01).
// XInput mode is invisible to node-hid on Windows (xusb22.sys serves no HID
// input reports), so DInput — hold B while powering on — is the supported mode.
// Layout verified against a live capture (2dc8:6012, 2.4G dongle, 2026-07).
// The home button and the L4/R4 paddles emit nothing in DInput mode by
// default, so they are unmapped; bytes 14-25 are gyro/accel and are ignored.

import type { ButtonId, ControllerEvent } from '../types.js'

export const EIGHTBITDO_VID = 0x2dc8
// Ultimate 2 Wireless for PC in DInput mode (2.4G dongle and Bluetooth).
export const EIGHTBITDO_PIDS = [0x6012]

function axis(raw: number): number {
  return Math.max(-1, Math.min(1, (raw - 128) / 128))
}

/**
 * Parse an Ultimate 2 Wireless 0x01 input report (34 bytes):
 * byte 1 = d-pad hat (0=N clockwise to 7=NW, 0x0f released); bytes 2-5 =
 * sticks (0-255, center 0x7f); byte 6 = R2 analog, byte 7 = L2 analog
 * (0-255, R2 first — verified against capture); byte 8 = south/east/west/
 * north/L1/R1 bits; byte 9 = trigger clicks, view/menu, L3/R3 bits.
 */
export function parse8BitDoReport(data: Buffer): ControllerEvent[] {
  const events: ControllerEvent[] = []
  if (data.length < 10 || data[0] !== 0x01) return events

  const hat = data[1]! & 0x0f
  events.push({ kind: 'button', button: 'dpad_up', pressed: hat === 7 || hat === 0 || hat === 1 })
  events.push({ kind: 'button', button: 'dpad_right', pressed: hat >= 1 && hat <= 3 })
  events.push({ kind: 'button', button: 'dpad_down', pressed: hat >= 3 && hat <= 5 })
  events.push({ kind: 'button', button: 'dpad_left', pressed: hat >= 5 && hat <= 7 })

  events.push({ kind: 'axis', axis: 'left_x', value: axis(data[2]!) })
  events.push({ kind: 'axis', axis: 'left_y', value: axis(data[3]!) })
  events.push({ kind: 'axis', axis: 'right_x', value: axis(data[4]!) })
  events.push({ kind: 'axis', axis: 'right_y', value: axis(data[5]!) })

  const b8 = data[8]!
  const b9 = data[9]!
  const map: Array<[number, number, ButtonId]> = [
    [b8, 0x01, 'south'],
    [b8, 0x02, 'east'],
    // 0x04/0x20 are the R4/L4 back paddles — verified live; the firmware
    // gives them distinct codes out of the box in DInput mode.
    [b8, 0x04, 'r4'],
    [b8, 0x08, 'west'],
    [b8, 0x10, 'north'],
    [b8, 0x20, 'l4'],
    [b8, 0x40, 'l1'],
    [b8, 0x80, 'r1'],
    [b9, 0x04, 'view'],
    [b9, 0x08, 'menu'],
    [b9, 0x20, 'l3'],
    [b9, 0x40, 'r3'],
  ]
  for (const [byte, bit, id] of map) {
    events.push({ kind: 'button', button: id, pressed: (byte & bit) !== 0 })
  }

  const rt = data[6]! / 255
  const lt = data[7]! / 255
  events.push({ kind: 'axis', axis: 'l2', value: lt })
  events.push({ kind: 'axis', axis: 'r2', value: rt })
  events.push({ kind: 'button', button: 'l2', pressed: lt > 0.25 })
  events.push({ kind: 'button', button: 'r2', pressed: rt > 0.25 })

  return events
}
