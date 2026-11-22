// Usage: node tools/make_reel.js <post-folder> "<reel hook, <=7 words>" "@handle"
// Makes <post-folder>/reel.mp4 (1080x1920, ~18s, H.264 + silent AAC) and <post-folder>/story.jpg (1080x1920)
// from slide-N.jpg files. Uses slides 1..N-1 (skips CTA) then a closing follow card.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const [dir, hook, handle] = process.argv.slice(2);
if (!dir || !hook || !handle) { console.error('args: dir hook handle'); process.exit(1); }
const slides = fs.readdirSync(dir).filter(f => /^slide-\d+\.jpg$/.test(f)).sort((a,b)=>parseInt(a.slice(6))-parseInt(b.slice(6)));
const use = slides.slice(0, -1); // drop CTA slide
const tmp = fs.mkdtempSync('/tmp/reel-');
const b64 = f => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(dir, f)).toString('base64');
const css = `*{margin:0;padding:0;box-sizing:border-box}body{width:1080px;height:1920px;background:#0B0D12;color:#F2F4F8;font-family:'DM Sans';overflow:hidden;position:relative}
.top{position:absolute;left:90px;right:90px;top:150px;height:250px;display:flex;align-items:flex-end;font-family:'Archivo Black';font-size:76px;line-height:1.05}
.a{color:#C6FF3D}.img{position:absolute;left:90px;top:440px;width:900px;height:1125px;border-radius:28px;overflow:hidden;border:3px solid #1E222B}
.img img{width:100%;height:100%}.ft{position:absolute;left:90px;right:90px;bottom:230px;display:flex;justify-content:space-between;font-size:38px;font-weight:700;color:#8A90A0}`;
(async () => {
  const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const p = await br.newPage({ viewport: { width: 1080, height: 1920 } });
  const frames = [];
  for (let i = 0; i < use.length; i++) {
    const nS = use.length - 3;
    const top = i === 0 ? hook : i === 1 ? 'Why it <span class="a">matters</span>' : i === use.length - 1 ? 'Screenshot <span class="a">this</span>' : `Story <span class="a">${i - 1}</span> of ${nS}`;
    await p.setContent(`<style>${css}</style><div class="top"><div>${top}</div></div><div class="img"><img src="${b64(use[i])}"></div><div class="ft"><span>${handle}</span><span>New every 7am + 6:30pm IST</span></div>`);
    await p.evaluate(() => document.fonts.ready);
    const f = path.join(tmp, `f${i}.png`); await p.screenshot({ path: f }); frames.push(f);
    if (i === 0) await p.screenshot({ path: path.join(dir, 'story.jpg'), type: 'jpeg', quality: 90 });
  }
  await p.setContent(`<style>${css}.c{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:120px;font-family:'Archivo Black';font-size:110px;line-height:1.05}</style><div class="c"><div>Follow for AI news that <span class="a">actually matters</span></div><div style="font-family:'DM Sans';font-weight:700;font-size:56px;color:#C6FF3D;margin-top:60px">${handle}</div></div>`);
  await p.evaluate(() => document.fonts.ready);
  const end = path.join(tmp, 'end.png'); await p.screenshot({ path: end }); frames.push(end);
  await br.close();
  // durations: cover 3s, stories 3.2s each, recap 3.5s, end 2.5s; 0.4s crossfades; gentle zoom on each
  const D = frames.map((_, i) => i === 0 ? 3 : i === frames.length - 1 ? 2.5 : i === frames.length - 2 ? 3.5 : 3.2);
  const args = ['-y'];
  frames.forEach((f, i) => args.push('-loop', '1', '-framerate', '30', '-t', String(D[i]), '-i', f));
  args.push('-f', 'lavfi', '-t', '30', '-i', 'anullsrc=r=48000:cl=stereo');
  let fc = frames.map((_, i) => `[${i}:v]scale=1188:2112,zoompan=z='min(1+0.0009*on,1.1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,format=yuv420p,setsar=1,settb=1/30,setpts=N/30/TB[v${i}]`).join(';');
  let last = 'v0', off = 0;
  for (let i = 1; i < frames.length; i++) { off += D[i - 1] - 0.4; fc += `;[${last}][v${i}]xfade=transition=slideleft:duration=0.4:offset=${off.toFixed(2)}[x${i}]`; last = `x${i}`; }
  const out = path.join(dir, 'reel.mp4');
  args.push('-filter_complex', fc, '-map', `[${last}]`, '-map', `${frames.length}:a`, '-shortest', '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-b:v', '3500k', '-maxrate', '5M', '-bufsize', '8M', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out);
  execFileSync('ffmpeg', args, { stdio: ['ignore','ignore','pipe'] });
  console.log(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,width,height', '-of', 'compact', out]).toString());
})();
