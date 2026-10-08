"""Run only the minutes AI call on saved meetings, so the prompt can be tuned without the pipeline.

Each saved meeting is a folder holding transcript.txt and agenda.txt (the two texts the analyzer
fills into the prompt) and optionally baseline.md (older minutes to compare with). They live in
the private data folder next to the repo, at semantic-lighthouse-data/prompt-test/fixtures.

    python prompt-test.py                                   # every saved meeting
    python prompt-test.py 2-tempe-2026-04-01-1h14m --prompt draft.txt

Uses the deployed analyzer code and model settings (TRANSCRIPT_MODEL_ID / TRANSCRIPT_EFFORT
env vars override them). Needs AWS_PROFILE=semlighthouse and the analyzer's packages:
pip install boto3 -r lambda/src/process_transcript/requirements.txt
"""
import argparse
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.environ.setdefault("AWS_REGION", "us-west-2")
sys.path.insert(0, str(HERE / "lambda/src/process_transcript"))
import handler  # noqa: E402

parser = argparse.ArgumentParser()
parser.add_argument("meetings", nargs="*", help="saved meeting folder names (default: all)")
parser.add_argument("--prompt", default=HERE / "lambda/src/process_transcript/transcript-analysis.txt")
parser.add_argument("--data", default=HERE.parent.parent / "semantic-lighthouse-data")
args = parser.parse_args()

fixtures = Path(args.data) / "prompt-test/fixtures"
names = args.meetings or sorted(d.name for d in fixtures.iterdir() if d.is_dir())
prompt = Path(args.prompt).read_text()
out = Path(args.data) / "prompt-test/runs" / time.strftime("%Y%m%d-%H%M%S")
out.mkdir(parents=True)
(out / "prompt.txt").write_text(prompt)
print(f"Running {len(names)} meeting(s), output in {out}")


def words(text):
    return len(text.split())


def run(name):
    folder = fixtures / name
    start = time.time()
    try:
        minutes = handler.analyze_transcript_with_bedrock(
            (folder / "transcript.txt").read_text(), prompt, (folder / "agenda.txt").read_text()
        )
    except Exception as e:
        return f"{name}: FAILED after {time.time() - start:.0f}s: {e}"
    (out / f"{name}.md").write_text(minutes)
    baseline = folder / "baseline.md"
    old = f", old minutes {words(baseline.read_text())} words" if baseline.exists() else ""
    return f"{name}: {words(minutes)} words (~{words(minutes) / 500:.1f} pages) in {time.time() - start:.0f}s{old}"


with ThreadPoolExecutor(len(names)) as pool:
    for done in as_completed([pool.submit(run, name) for name in names]):
        print(done.result())
