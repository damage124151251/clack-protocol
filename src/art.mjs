export const PALETTE = {
  paper: "#f5f5ef",
  ground: "#e9eaec",
  ink: "#202123",
  silver: "#b8bbc2",
  light: "#d9dce1",
  blue: "#3659d9",
  salmon: "#eb986c",
  olive: "#968848",
};
const rect = (c, x, y, w, h, color) => {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};
export function printer(
  c,
  x,
  y,
  scale = 1,
  t = 0,
  feed = 0.65,
  text = "CLACK",
) {
  c.save();
  c.translate(Math.round(x), Math.round(y));
  c.scale(scale, scale);
  c.imageSmoothingEnabled = false;
  rect(c, -107, 50, 220, 8, "#c9cbd0");
  rect(c, -96, -6, 184, 57, PALETTE.ink);
  rect(c, -99, 3, 7, 33, "#70757e");
  rect(c, 88, 1, 11, 36, "#6e727a");
  rect(c, -91, -16, 184, 53, PALETTE.silver);
  rect(c, -87, -22, 177, 43, PALETTE.light);
  rect(c, -83, -25, 169, 8, "#f6f7f8");
  rect(c, -82, -18, 164, 2, "#949aa4");
  rect(c, -73, -23, 94, 9, "#383b42");
  rect(c, -68, -21, 84, 3, "#111418");
  const height = Math.round(17 + feed * 87),
    bottom = -19;
  rect(c, -61, bottom - height, 76, height, PALETTE.paper);
  rect(c, 11, bottom - height, 4, height, "#d7d9d6");
  for (let k = 0; k < 13; k++)
    rect(
      c,
      -61 + k * 6,
      bottom - height - (k % 2 ? 0 : 2),
      3,
      3,
      PALETTE.paper,
    );
  c.save();
  c.beginPath();
  c.rect(-57, bottom - height + 4, 66, height - 7);
  c.clip();
  c.fillStyle = PALETTE.ink;
  c.textAlign = "center";
  c.font = '10px "Silkscreen", monospace';
  c.fillText(text, -25, bottom - height + 19);
  for (let n = 0; n < 6; n++) {
    const py = bottom - height + 29 + n * 8;
    rect(c, -51, py, 15 + ((n * 13) % 25), 2, n % 3 ? "#a5a9a7" : "#626764");
    rect(c, -3, py, 8, 2, "#8c918e");
  }
  if (feed > 0.74) {
    rect(c, -47, bottom - height + 80, 45, 11, PALETTE.blue);
    c.fillStyle = "#fff";
    c.font = '5px "IBM Plex Mono", monospace';
    c.fillText("ON RECORD", -25, bottom - height + 87);
  }
  c.restore();
  rect(c, 28, -9, 49, 20, "#696f78");
  rect(c, 31, -6, 43, 14, "#202b35");
  c.font = '6px "IBM Plex Mono", monospace';
  c.fillStyle = "#c8dce4";
  c.textAlign = "left";
  c.fillText(feed > 0.85 ? "RECORDED" : "CLACK / 01", 34, 3);
  for (let r = 0; r < 3; r++)
    for (let col = 0; col < 11; col++) {
      const kx = -77 + col * 12,
        ky = 12 + r * 7;
      rect(c, kx, ky + 2, 10, 5, "#858a93");
      rect(
        c,
        kx,
        ky,
        10,
        4,
        feed > 0 && feed < 0.85 && Math.floor(t * 11) % 33 === r * 11 + col
          ? PALETTE.blue
          : "#f0f1f1",
      );
    }
  rect(c, 61, 14, 17, 12, PALETTE.salmon);
  rect(c, 61, 27, 17, 4, "#985d44");
  rect(c, -79, 37, 145, 5, "#626a75");
  rect(c, -70, 39, 119, 2, "#333945");
  rect(c, -88, 43, 8, 10, "#202123");
  rect(c, 74, 43, 8, 10, "#202123");
  rect(c, 82, -12, 3, 3, feed > 0.1 ? PALETTE.blue : "#81878f");
  c.restore();
}
export function drawDesk(c, w, h, t, printing = false) {
  c.clearRect(0, 0, w, h);
  const scale = Math.min(w / 300, h / 240, 3),
    center = w / 2;
  const ground = h * 0.78;
  rect(c, 20, ground + 1, w - 40, 1, "#c1c4cb");
  for (let x = 20; x < w - 20; x += 14)
    rect(c, x, ground + 12, 2, 2, "#c1c4cb");
  printer(
    c,
    center,
    ground - 53 * scale,
    scale,
    t,
    printing ? 0.25 + (t % 2.8) / 3.5 : 0.83,
  );
  c.font = '11px "IBM Plex Mono", monospace';
  c.fillStyle = "#787d85";
  c.textAlign = "center";
  c.fillText("CLACK  /  RECEIPT UNIT 001", center, h - 14);
}
export function drawIntro(c, w, h, t) {
  rect(c, 0, 0, w, h, PALETTE.ink);
  const feed = Math.min(1, Math.max(0, (t - 0.4) / 2.3)),
    scale = Math.min(w / 310, h / 250, 3.7);
  if (t < 3) printer(c, w / 2, h / 2 + 36 * scale, scale, t, feed);
  else {
    const progress = Math.min(1, (t - 3) / 0.8),
      width = 80 * scale + (w - 80 * scale) * progress;
    rect(c, (w - width) / 2, 0, width, h, PALETTE.paper);
    c.font = '40px "Silkscreen", monospace';
    c.fillStyle = PALETTE.ink;
    c.textAlign = "center";
    c.fillText("CLACK", w / 2, h / 2);
  }
}
export function drawBrand(c, w, h, kind = "logo") {
  c.clearRect(0, 0, w, h);
  if (kind !== "transparent") rect(c, 0, 0, w, h, PALETTE.ink);
  if (kind === "banner") {
    printer(c, w * 0.24, h * 0.57, 2.2, 0, 0.85);
    c.fillStyle = PALETTE.paper;
    c.textAlign = "left";
    c.font = '82px "Silkscreen", monospace';
    c.fillText("CLACK", w * 0.43, h * 0.48);
    c.font = '22px "IBM Plex Mono", monospace';
    c.fillText("Every movement. On record.", w * 0.43, h * 0.62);
    rect(c, w * 0.43, h * 0.73, 90, 6, PALETTE.blue);
    rect(c, w * 0.43 + 105, h * 0.73, 30, 6, PALETTE.salmon);
  } else {
    printer(c, w / 2, h * 0.59, w / 257, 0, 0.87);
  }
}
export function drawFilm(c, w, h, t, variant = 0) {
  const phase = Math.min(2, Math.floor(t / 2.65)),
    dark = phase === 2;
  rect(c, 0, 0, w, h, dark ? PALETTE.ink : PALETTE.ground);
  c.textAlign = "left";
  c.fillStyle = dark ? PALETTE.paper : PALETTE.ink;
  c.font = `${w * 0.04}px "Silkscreen", monospace`;
  const words = [
    ["RECEIVE.", "RECONCILE.", "ON RECORD."],
    ["ONE TREASURY.", "EXACT SPLITS.", "ONE RECEIPT."],
    ["NOT A COUNTER.", "A CHAIN RECORD.", "CLACK."],
  ][variant];
  c.fillText(words[phase], w * 0.065, h * 0.18);
  const scale =
    Math.min(w / 400, h / 215) *
    (1 + Math.sin((Math.min(1, t % 2.65) * Math.PI) / 2) * 0.06);
  printer(c, w * 0.52, h * 0.68, scale, t, 0.2 + (t % 2.65) / 3.2);
  c.textAlign = "right";
  c.fillStyle = dark ? "#c9cbd0" : "#5e626c";
  c.font = `${w * 0.014}px "IBM Plex Mono", monospace`;
  c.fillText("CLACK / Every movement. On record.", w * 0.935, h * 0.91);
  c.textAlign = "left";
  c.font = `${w * 0.01}px "IBM Plex Mono", monospace`;
  c.fillText(
    "Illustrative workflow. Payments require treasury approval.",
    w * 0.065,
    h * 0.95,
  );
  rect(c, w * 0.065, h * 0.84, w * 0.18 * ((t % 2.65) / 2.65), 5, PALETTE.blue);
}
