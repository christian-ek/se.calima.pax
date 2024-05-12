export default class FanSpeed {
  Humidity: number;
  Light: number;
  Trickle: number;

  constructor(humidity: number = 2250, light: number = 1625, trickle: number = 1000) {
    this.Humidity = humidity;
    this.Light = light;
    this.Trickle = trickle;
  }

  toString(): string {
    return `Fanspeed: Humidity = ${this.Humidity}, Light = ${this.Light}, Trickle = ${this.Trickle}`;
  }
}
