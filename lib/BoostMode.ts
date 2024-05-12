export default class BoostMode {
  OnOff: boolean;
  Speed: number;
  Seconds: number;

  constructor(onOff: boolean, speed: number, seconds: number) {
    this.OnOff = onOff;
    this.Speed = speed;
    this.Seconds = seconds;
  }

  toString(): string {
    return `BoostMode: OnOff = ${this.OnOff}, Speed = ${this.Speed}, Seconds = ${this.Seconds}`;
  }
}
