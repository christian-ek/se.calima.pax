export default class FanState {
  Humidity: number;
  Temp: number;
  Light: number;
  RPM: number;
  Mode: string;

  constructor(humidity: number, temperature: number, light: number, rpm: number, mode: string) {
    this.Humidity = humidity;
    this.Temp = temperature;
    this.Light = light;
    this.RPM = rpm;
    this.Mode = mode;
  }

  toString(): string {
    return `Fan state: Humidity = ${this.Humidity}, Temperature = ${this.Temp}, Light = ${this.Light}, RPM = ${this.RPM}, Mode = ${this.Mode}`;
  }
}
