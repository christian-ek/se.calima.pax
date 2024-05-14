export default class FanMode {
  static readonly modes = [
    'MultiMode',
    'DraftShutterMode',
    'WallSwitchExtendedRuntimeMode',
    'WallSwitchNoExtendedRuntimeMode',
    'HeatDistributionMode',
  ] as const;

  static getModeByIndex(index: number): string | undefined {
    return FanMode.modes[index] ?? undefined;
  }

  static isHeatDistributionMode(mode: string): boolean {
    return mode === 'HeatDistributionMode';
  }
}
