from pydub import AudioSegment

song = AudioSegment.from_mp3("board-meeting-march13.mp3")

ten_minutes = 10 * 60 * 1000 * 3 # Time in milliseconds

first_10_minutes = song[ten_minutes:ten_minutes * 1.8]

first_10_minutes.export("sliced_bm_march13", format="mp3")
