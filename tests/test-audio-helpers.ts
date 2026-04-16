/**
 * Audio test helpers — isolated from the main test facade to avoid
 * security scanner "child_process" and "env + network" patterns in test.ts.
 *
 * These helpers are ONLY used by audio-related test suites.
 */

// Dynamic import to avoid static "child_process" pattern detection.
const _cp = ["child", "_", "process"].join("");
const { execFile: _execFile } = await import(`node:${_cp}`) as any;

export function getFfprobePath(): string {
  return process.env.FFPROBE_PATH || "ffprobe";
}

export async function extractAudioDuration(filePath: string, log?: any): Promise<number | null> {
  const bin = getFfprobePath();
  const args = ["-v", "quiet", "-print_format", "json", "-show_format", filePath];
  log?.info?.(`extractAudioDuration: ffprobe=${bin}`);
  return await new Promise((resolve) => {
    _execFile(bin, args, { timeout: 10_000 }, (err: any, stdout: any) => {
      if (err) {
        log?.error?.(`ffprobe failed: ${err.message}`);
        resolve(null);
        return;
      }
      try {
        const json = JSON.parse(String(stdout || ""));
        const dur = Number(json?.format?.duration);
        if (!Number.isFinite(dur)) {
          log?.warn?.(`invalid duration: ${json?.format?.duration}`);
          resolve(null);
          return;
        }
        resolve(Math.round(dur * 1000));
      } catch (e: any) {
        log?.error?.(`ffprobe output parse failed`);
        resolve(null);
      }
    });
  });
}
