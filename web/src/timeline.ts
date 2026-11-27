/** 年の再生。1年あたり secPerYear 秒、5年刻みの間も連続で進む。止めるのはスライダー操作か一時停止。 */
export class Player {
  year: number;
  playing = false;
  private last = 0;
  private raf = 0;
  constructor(
    private from: number,
    private to: number,
    public secPerYear: number,
    private onYear: (y: number) => void,
    private onState: (playing: boolean) => void,
  ) {
    this.year = from;
  }
  private tick = (t: number) => {
    if (!this.playing) return;
    if (this.last) this.year = Math.min(this.to, this.year + (t - this.last) / 1000 / this.secPerYear);
    this.last = t;
    this.onYear(this.year);
    if (this.year >= this.to) return this.pause();
    this.raf = requestAnimationFrame(this.tick);
  };
  play() {
    if (this.year >= this.to) this.year = this.from;
    this.playing = true;
    this.last = 0;
    this.onState(true);
    this.raf = requestAnimationFrame(this.tick);
  }
  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.onState(false);
  }
  toggle() {
    this.playing ? this.pause() : this.play();
  }
  set(y: number) {
    this.year = Math.max(this.from, Math.min(this.to, y));
    this.onYear(this.year);
  }
}

/** 表示用の数値を目標値へなめらかに寄せる（府人口のカウントアップ／ダウン） */
export class Tween {
  value: number;
  private target: number;
  private raf = 0;
  constructor(v: number, private onValue: (v: number) => void) {
    this.value = this.target = v;
  }
  to(v: number, immediate = false) {
    this.target = v;
    if (immediate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.value = v;
      this.onValue(v);
      return;
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.step);
  }
  private step = () => {
    const d = this.target - this.value;
    this.value = Math.abs(d) < 1 ? this.target : this.value + d * 0.22;
    this.onValue(this.value);
    this.raf = this.value === this.target ? 0 : requestAnimationFrame(this.step);
  };
}
