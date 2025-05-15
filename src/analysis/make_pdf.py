import datetime
import re
import json
import markdown
import pdfkit
from datetime import timedelta
import os, platform, subprocess
from weasyprint import HTML

def setup_macos_libraries():
    """Setup Homebrew library paths for macOS"""
    if platform.system() == "Darwin":
        try:
            prefix = subprocess.check_output(["brew", "--prefix"], text=True).strip()
            libdir = os.path.join(prefix, "lib")
            os.environ["DYLD_LIBRARY_PATH"] = f"{libdir}:{os.environ.get('DYLD_LIBRARY_PATH','')}"
            return True
        except Exception as e:
            print(f"Warning: Could not setup Homebrew libraries: {e}")
            return False
    return True

# Setup libraries before importing WeasyPrint
setup_macos_libraries()

def format_timestamp(seconds):
    """Convert seconds to HH:MM:SS format for YouTube timestamps"""
    return str(int(seconds))

def create_youtube_link(base_url, timestamp):
    """Create a clickable YouTube link with timestamp"""
    return f"{base_url}#t={timestamp}"

def replace_segments_with_links(text, segments_data, base_url):
    """Replace segment references in text with YouTube links"""
    # First, handle ranges like [seg_4-5]
    range_pattern = r'\[seg_(\d+)-(\d+)\]'

    def range_replacer(match):
        start_seg = int(match.group(1))
        end_seg = int(match.group(2))

        start_id = f"seg_{start_seg}"
        end_id = f"seg_{end_seg}"

        start_time = None
        end_time = None

        for segment in segments_data:
            if segment["id"] == start_id:
                start_time = segment["start_time"]
            if segment["id"] == end_id:
                end_time = segment["end_time"]

        if start_time is not None:
            timestamp = format_timestamp(start_time)
            link = create_youtube_link(base_url, timestamp)
            return f"[segments {start_seg}-{end_seg}]({link})"
        else:
            return match.group(0)  # Return original if not found

    text = re.sub(range_pattern, range_replacer, text)

    # Then handle individual segments like [seg_0]
    single_pattern = r'\[seg_(\d+)\]'

    def single_replacer(match):
        seg_num = match.group(1)
        seg_id = f"seg_{seg_num}"

        for segment in segments_data:
            if segment["id"] == seg_id:
                timestamp = format_timestamp(segment["start_time"])
                link = create_youtube_link(base_url, timestamp)
                return f"[segment {seg_num}]({link})"

        return match.group(0)  # original if not found

    text = re.sub(single_pattern, single_replacer, text)

    return text

def create_pdf(summary_file: str, sequential_json: str, output_file: str, youtube_url: str):
    """
    Create a PDF document containing the summary with clickable segment links.
    
    Args:
        summary_file (str): Path to the summary file
        sequential_json (str): Path to the sequential transcript JSON file
        output_file (str): Path where the PDF should be saved
        youtube_url (str): URL of the YouTube video
    """
    # Read summary content
    try:
        with open(summary_file, 'r', encoding='utf-8') as f:
            summary_text = f.read()
    except Exception as e:
        summary_text = f"Error reading summary: {str(e)}"

    # Read transcript data for segment timestamps
    try:
        with open(sequential_json, 'r', encoding='utf-8') as f:
            segments_data = json.load(f)
    except Exception as e:
        print(f"Warning: Could not load segment data: {e}")
        segments_data = []

    # Replace segment references with YouTube links
    summary_text = replace_segments_with_links(summary_text, segments_data, youtube_url)

    # Convert markdown to HTML
    html_content = markdown.markdown(summary_text)

    # Create the HTML content with styling
    styled_html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Board Meeting Analysis</title>
        <style>
            body {{
                font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
                line-height: 1.6;
                margin: 0;
                padding: 0;
                background-color: #f9f9f9;
                color: #333;
            }}

            .container {{
                max-width: 900px;
                margin: 0 auto;
                background-color: white;
                padding: 40px;
                box-shadow: 0 0 20px rgba(0, 0, 0, 0.1);
                border-radius: 5px;
            }}

            h1 {{
                color: #2c3e50;
                border-bottom: 2px solid #3498db;
                padding-bottom: 10px;
                font-size: 28px;
                margin-top: 0;
            }}

            h2 {{
                color: #3498db;
                margin-top: 30px;
                font-size: 22px;
                border-left: 4px solid #3498db;
                padding-left: 10px;
            }}

            h3 {{
                color: #2c3e50;
                font-size: 18px;
                margin-top: 25px;
                border-bottom: 1px solid #eee;
                padding-bottom: 5px;
            }}

            p {{
                margin-bottom: 15px;
                text-align: justify;
            }}

            a {{
                color: #3498db;
                text-decoration: none;
                transition: all 0.3s ease;
                background-color: #e8f4fc;
                padding: 2px 5px;
                border-radius: 3px;
                font-weight: 500;
            }}

            a:hover {{
                color: #2980b9;
                background-color: #d0e9f9;
            }}

            ul, ol {{
                margin-left: 20px;
                margin-bottom: 20px;
            }}

            li {{
                margin-bottom: 8px;
            }}

            blockquote {{
                border-left: 4px solid #3498db;
                padding: 10px 20px;
                margin-left: 0;
                margin-right: 0;
                background-color: #f8f8f8;
                color: #555;
            }}

            .footer {{
                margin-top: 40px;
                padding-top: 20px;
                border-top: 1px solid #eee;
                font-size: 14px;
                color: #777;
                text-align: center;
            }}

            .header {{
                text-align: center;
                margin-bottom: 30px;
            }}

            .timestamp {{
                font-family: monospace;
                color: #666;
                font-size: 0.9em;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Board Meeting Analysis</h1>
                <p class="timestamp">Generated on {datetime.datetime.now().strftime('%B %d, %Y at %H:%M')}</p>
                <p>Source: <a href="{youtube_url}">{youtube_url}</a></p>
            </div>

            {html_content}

            <div class="footer">
                <p>© {datetime.datetime.now().year} Board Meeting Analysis</p>
            </div>
        </div>
    </body>
    </html>
    """

    # Convert HTML to PDF
    try:
        HTML(string=styled_html).write_pdf(output_file)
        print(f"Successfully generated PDF: {output_file}")
    except Exception as e:
        print(f"Error generating PDF: {e}")
        # Save HTML as fallback
        html_file = output_file.replace('.pdf', '.html')
        with open(html_file, 'w', encoding='utf-8') as f:
            f.write(styled_html)
        print(f"HTML file has been saved as {html_file}")

def main():
    youtube_url = "https://www.youtube.com/watch?v=QgrSLH-1WIw"

    try:
        with open("transcript_analysis.txt", "r", encoding="utf-8") as file:
            analysis_text = file.read()
    except FileNotFoundError:
        print("Error: transcript_analysis.txt file not found.")
        return

    try:
        with open("sequential_transcript.json", "r", encoding="utf-8") as file:
            segments_data = json.load(file)
    except FileNotFoundError:
        print("Error: sequential_transcript.json file not found.")
        return
    except json.JSONDecodeError:
        print("Error: sequential_transcript.json is not a valid JSON file.")
        return

    # Replace segment references with YouTube links
    updated_text = replace_segments_with_links(analysis_text, segments_data, youtube_url)

    # Convert markdown to HTML
    html_content = markdown.markdown(updated_text)

    # Add styling to make the PDF look better
    styled_html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Board Meeting Analysis</title>
        <style>
            body {{
                font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
                line-height: 1.6;
                margin: 0;
                padding: 0;
                background-color: #f9f9f9;
                color: #333;
            }}

            .container {{
                max-width: 900px;
                margin: 0 auto;
                background-color: white;
                padding: 40px;
                box-shadow: 0 0 20px rgba(0, 0, 0, 0.1);
                border-radius: 5px;
            }}

            h1 {{
                color: #2c3e50;
                border-bottom: 2px solid #3498db;
                padding-bottom: 10px;
                font-size: 28px;
                margin-top: 0;
            }}

            h2 {{
                color: #3498db;
                margin-top: 30px;
                font-size: 22px;
                border-left: 4px solid #3498db;
                padding-left: 10px;
            }}

            h3 {{
                color: #2c3e50;
                font-size: 18px;
                margin-top: 25px;
                border-bottom: 1px solid #eee;
                padding-bottom: 5px;
            }}

            p {{
                margin-bottom: 15px;
                text-align: justify;
            }}

            a {{
                color: #3498db;
                text-decoration: none;
                transition: all 0.3s ease;
                background-color: #e8f4fc;
                padding: 2px 5px;
                border-radius: 3px;
                font-weight: 500;
            }}

            a:hover {{
                color: #2980b9;
                background-color: #d0e9f9;
            }}

            ul, ol {{
                margin-left: 20px;
                margin-bottom: 20px;
            }}

            li {{
                margin-bottom: 8px;
            }}

            blockquote {{
                border-left: 4px solid #3498db;
                padding: 10px 20px;
                margin-left: 0;
                margin-right: 0;
                background-color: #f8f8f8;
                color: #555;
            }}

            .footer {{
                margin-top: 40px;
                padding-top: 20px;
                border-top: 1px solid #eee;
                font-size: 14px;
                color: #777;
                text-align: center;
            }}

            .header {{
                text-align: center;
                margin-bottom: 30px;
            }}

            .timestamp {{
                font-family: monospace;
                color: #666;
                font-size: 0.9em;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Board Meeting Analysis</h1>
                <p class="timestamp">Generated on {datetime.datetime.now().strftime('%B %d, %Y at %H:%M')}</p>
            </div>

            {html_content}

            <div class="footer">
                <p>© {datetime.datetime.now().year} Board Meeting Analysis</p>
            </div>
        </div>
    </body>
    </html>
    """

    # Convert HTML to PDF
    try:
        HTML(string=styled_html).write_pdf("nicer_transcript_analysis_with_links.pdf")
        print("Successfully generated PDF: nicer_transcript_analysis_with_links.pdf")
    except Exception as e:
        print(f"Error generating PDF: {e}")
        print("HTML file has been saved as transcript_analysis_with_links.html")

if __name__ == "__main__":
    main()
