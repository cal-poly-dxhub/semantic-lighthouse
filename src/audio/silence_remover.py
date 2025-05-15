import os
import sys
import time
from pydub import AudioSegment
from pydub.silence import detect_silence
from colorama import init, Fore, Style

init()

def format_time(milliseconds):
    """Convert milliseconds to a human-readable format."""
    seconds = milliseconds / 1000
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)

    if hours > 0:
        return f"{int(hours)}h {int(minutes)}m {seconds:.1f}s"
    elif minutes > 0:
        return f"{int(minutes)}m {seconds:.1f}s"
    else:
        return f"{seconds:.1f}s"

def reduce_silence(input_file, output_file):
    """
    Reduce silences in an audio file using preset parameters.

    Parameters:
    - input_file: Path to input audio file
    - output_file: Path to output audio file
    """
    try:
        # Preset parameters
        silence_thresh = -30
        min_silence_len = 8000
        keep_silence = 500

        print(f"{Fore.CYAN}Loading audio file: {Fore.WHITE}{input_file}{Style.RESET_ALL}")
        start_time = time.time()

        # Load audio file
        audio = AudioSegment.from_file(input_file)
        original_length = len(audio)

        print(f"{Fore.CYAN}Original audio length: {Fore.WHITE}{format_time(original_length)}{Style.RESET_ALL}")

        # Detect silent sections
        print(f"{Fore.CYAN}Detecting silence (threshold: {silence_thresh}dB, min length: {min_silence_len}ms){Style.RESET_ALL}")
        silent_ranges = detect_silence(
            audio,
            min_silence_len=min_silence_len,
            silence_thresh=silence_thresh
        )

        # Process the audio to reduce silence
        print(f"{Fore.YELLOW}Reducing silence...{Style.RESET_ALL}")
        processed_audio = AudioSegment.empty()
        start_pos = 0

        for start, end in silent_ranges:
            # Add the audio before silence
            processed_audio += audio[start_pos:start]

            # Add a shorter version of the silence
            silence_duration = min(keep_silence, end - start)
            if silence_duration > 0:
                silence = AudioSegment.silent(duration=silence_duration)
                processed_audio += silence

            # Update position
            start_pos = end

        # Add the remaining audio after the last silence
        if start_pos < len(audio):
            processed_audio += audio[start_pos:]

        # Calculate reduction
        new_length = len(processed_audio)
        reduction_ms = original_length - new_length
        reduction_percent = (reduction_ms / original_length) * 100

        # Export the result
        print(f"{Fore.YELLOW}Exporting to: {Fore.WHITE}{output_file}{Style.RESET_ALL}")
        processed_audio.export(output_file, format=os.path.splitext(output_file)[1][1:])

        end_time = time.time()
        processing_time = end_time - start_time

        print(f"\n{Fore.GREEN}✓ Processing complete in {processing_time:.1f} seconds{Style.RESET_ALL}")
        print(f"{Fore.GREEN}✓ Output saved to: {Fore.WHITE}{output_file}{Style.RESET_ALL}")
        print(f"\n{Fore.CYAN}Original length: {Fore.WHITE}{format_time(original_length)}{Style.RESET_ALL}")
        print(f"{Fore.CYAN}New length: {Fore.WHITE}{format_time(new_length)}{Style.RESET_ALL}")
        print(f"{Fore.CYAN}Reduced by: {Fore.WHITE}{format_time(reduction_ms)} ({reduction_percent:.1f}%){Style.RESET_ALL}")

        return True

    except Exception as e:
        print(f"{Fore.RED}Error processing audio: {e}{Style.RESET_ALL}")
        return False

def main():
    if len(sys.argv) != 3:
        print(f"{Fore.RED}Usage: python {os.path.basename(__file__)} <input_file> <output_file>{Style.RESET_ALL}")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2]

    if not os.path.exists(input_file):
        print(f"{Fore.RED}Error: Input file '{input_file}' does not exist.{Style.RESET_ALL}")
        sys.exit(1)

    reduce_silence(input_file, output_file)

if __name__ == "__main__":
    main()
