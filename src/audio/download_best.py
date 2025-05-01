from yt_dlp import YoutubeDL
from tqdm import tqdm

URLS = ['https://www.youtube.com/watch?v=wCYCR55gDjM&t=2004s']

ydl_opts = {
    'format': 'bestaudio',
    'postprocessors': [{
        'key': 'FFmpegExtractAudio',
        'preferredcodec': 'mp3',
        'preferredquality': '320',
    }],
    'outtmpl': '%(title)s.%(ext)s',
    'verbose': True,
    'quiet': False,
    'no_warnings': False,
    'audio_quality': 0,
    'extract_audio': True,
}

def download_audio(url):
    with YoutubeDL(ydl_opts) as ydl:
        try:
            ydl.download([url])
        except Exception as e:
            print(f"Error downloading {url}: {str(e)}")

if __name__ == '__main__':
    for url in tqdm(URLS, desc="Downloading", unit="file"):
        download_audio(url)
    print("Download complete.")
