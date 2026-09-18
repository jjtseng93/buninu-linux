export class Loc {
  constructor(x = 0, y = 0) {
    this.X = x;
    this.Y = y;
    this.x = x;
    this.y = y;
  }

  lessThan(other) {
    return this.Y < other.Y || (this.Y === other.Y && this.X < other.X);
  }

  greaterThan(other) {
    return this.Y > other.Y || (this.Y === other.Y && this.X > other.X);
  }

  greaterEqual(other) {
    return this.greaterThan(other) || (this.X === other.X && this.Y === other.Y);
  }

  lessEqual(other) {
    return this.lessThan(other) || (this.X === other.X && this.Y === other.Y);
  }

  clamp(start, end) {
    if (this.greaterEqual(end)) return end;
    if (this.lessThan(start)) return start;
    return this;
  }

  toJSON() {
    return { X: this.X, Y: this.Y };
  }
}

export function loc(x = 0, y = 0) {
  return new Loc(x, y);
}
