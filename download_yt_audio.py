from yt_dlp import YoutubeDL
from tqdm import tqdm

URLS = ['https://www.youtube.com/watch?v=dQw4w9WgXcQ']

ydl_opts = {
    'format': 'bestaudio/best',
    'postprocessors': [{
        'key': 'FFmpegExtractAudio',
        'preferredcodec': 'mp3',
        'preferredquality': '192',
    }],
    'outtmpl': '%(title)s.%(ext)s',
}

def download_audio(url):
    with YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

if __name__ == '__main__':
    for url in tqdm(URLS, desc="Downloading", unit="file"):
        download_audio(url)
    print("Download complete.")
