import { clamp, normalizeAngle } from './geometry';

export type TestDriveTransform = { x: number; y: number; angle: number };

/** Previous/current physics snapshots; never writes to the simulated car. */
export class TestDriveMotion {
  private previous: TestDriveTransform;
  private current: TestDriveTransform;

  constructor(transform: TestDriveTransform) {
    this.previous = { ...transform };
    this.current = { ...transform };
  }

  step(transform: TestDriveTransform) {
    this.previous = this.current;
    this.current = { ...transform };
  }

  reset(transform: TestDriveTransform) {
    this.previous = { ...transform };
    this.current = { ...transform };
  }

  sample(alpha: number): TestDriveTransform {
    const t = clamp(alpha, 0, 1);
    return {
      x: this.previous.x + (this.current.x - this.previous.x) * t,
      y: this.previous.y + (this.current.y - this.previous.y) * t,
      angle: normalizeAngle(this.previous.angle +
        normalizeAngle(this.current.angle - this.previous.angle) * t),
    };
  }
}
