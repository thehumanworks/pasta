export const ExitCode = {
  ok: 0,
  usage: 2,
  unavailable: 3,
  auth: 4,
  network: 5,
  unsupported: 6,
  internal: 70
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

