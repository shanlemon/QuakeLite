import { clamp } from '../../shared/math';
import { BUTTON_CROUCH, BUTTON_FIRE, BUTTON_JUMP, type UserCmd } from '../../shared/movement';
import type { InputSample } from './inputState';

export const MAX_CMD_MSEC = 100;

export interface FrameCommandInput {
  seq: number;
  dtMs: number;
  sample: InputSample;
  predicting: boolean;
  fireReady: boolean;
  renderTime: number;
  maxMsec?: number;
}

export function buildFrameCommand(input: FrameCommandInput): UserCmd {
  let buttons = 0;
  if (input.predicting) {
    buttons = input.sample.buttons & (BUTTON_JUMP | BUTTON_CROUCH);
    if ((input.sample.buttons & BUTTON_FIRE) !== 0 && input.fireReady) buttons |= BUTTON_FIRE;
  }

  return {
    seq: input.seq,
    msec: clamp(Math.round(input.dtMs), 1, input.maxMsec ?? MAX_CMD_MSEC),
    yaw: input.sample.yaw,
    pitch: input.sample.pitch,
    fmove: input.predicting ? input.sample.fmove : 0,
    smove: input.predicting ? input.sample.smove : 0,
    buttons,
    interpTime: Math.max(0, Math.floor(input.renderTime)),
  };
}
