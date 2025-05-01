import datetime
import re
import json
import markdown
import pdfkit
from datetime import timedelta
from weasyprint import HTML


def format_timestamp(seconds):
    """Convert seconds to HH:MM:SS format for YouTube timestamps"""
    return str(int(seconds))

def create_youtube_link(base_url, timestamp):
    """Create a clickable YouTube link with timestamp"""
    return f"{base_url}&t={timestamp}"

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

def main():
    youtube_url = "https://www.youtube.com/watch?v=wCYCR55gDjM"

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

    # Save the HTML to a file
    # with open("nicer_transcript_analysis_with_links.html", "w", encoding="utf-8") as file:
    #    file.write(styled_html)

    # Convert HTML to PDF
    try:
        HTML(string=styled_html).write_pdf("nicer_transcript_analysis_with_links.pdf")
        print("Successfully generated PDF: nicer_transcript_analysis_with_links.pdf")
    except Exception as e:
        print(f"Error generating PDF: {e}")
        print("HTML file has been saved as transcript_analysis_with_links.html")

if __name__ == "__main__":
    main()
