#!/usr/bin/env python3
"""
Test script to check which image format qwen3.5-122b-a10b model accepts
Tests PNG, JPEG, and WebP formats with base64 encoding
"""

import base64
from PIL import Image
import io
import json
import os
import urllib.request

# API configuration — any OpenAI-compatible server. Override with env vars.
API_URL = os.environ.get("VISION_API_URL", "http://127.0.0.1:1234/v1/chat/completions")
API_KEY = os.environ.get("VISION_API_KEY", "not-needed")
MODEL = os.environ.get("VISION_MODEL", "qwen3.5-122b-a10b")

def create_test_image():
    """Create a simple test image with text"""
    # Create a colorful test image (100x100 pixels)
    img = Image.new('RGB', (100, 100), color='lightblue')
    
    # Add some simple shapes using PIL drawing
    from PIL import ImageDraw
    draw = ImageDraw.Draw(img)
    
    # Draw a red circle
    draw.ellipse([10, 10, 40, 40], fill='red')
    
    # Draw a green rectangle
    draw.rectangle([50, 10, 90, 40], fill='green')
    
    # Draw a blue triangle (using polygon)
    draw.polygon([[10, 60], [40, 90], [5, 90]], fill='blue')
    
    return img

def image_to_base64_data_url(image, format='PNG'):
    """Convert PIL Image to base64 data URL"""
    buffer = io.BytesIO()
    
    # Map format to MIME type
    mime_types = {
        'PNG': 'image/png',
        'JPEG': 'image/jpeg',
        'WEBP': 'image/webp'
    }
    
    # Save image to buffer
    if format == 'JPEG':
        image.save(buffer, format=format, quality=85)
    else:
        image.save(buffer, format=format)
    
    buffer.seek(0)
    image_bytes = buffer.read()
    base64_str = base64.b64encode(image_bytes).decode('utf-8')
    
    mime_type = mime_types.get(format, 'image/png')
    data_url = f"data:{mime_type};base64,{base64_str}"
    
    return data_url, len(image_bytes)

def test_image_format(format_name):
    """Test a specific image format with the API"""
    print(f"\n{'='*60}")
    print(f"Testing format: {format_name}")
    print('='*60)
    
    # Create test image
    img = create_test_image()
    
    # Convert to base64 data URL
    data_url, file_size = image_to_base64_data_url(img, format=format_name)
    
    print(f"Format: {format_name}")
    print(f"MIME type: {data_url.split(';')[0].split(':')[1]}")
    print(f"File size: {file_size} bytes")
    print(f"Base64 length: {len(data_url.split(',')[1])} characters")
    
    # Prepare API request
    payload = {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "请描述这张图片的内容。"
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": data_url
                        }
                    }
                ]
            }
        ],
        "max_tokens": 100
    }
    
    # Send request to API using urllib
    try:
        req = urllib.request.Request(
            API_URL,
            data=json.dumps(payload).encode('utf-8'),
            headers={
                "Authorization": f"Bearer {API_KEY}",
                "Content-Type": "application/json"
            },
            method='POST'
        )
        
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode('utf-8'))
            
            if response.status == 200:
                print(f"\n✅ SUCCESS!")
                content = result['choices'][0]['message']['content']
                print(f"Response: {content[:200]}")
                return True, result
            else:
                print(f"\n❌ FAILED with status {response.status}")
                return False, result
                
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        print(f"\n❌ HTTP ERROR {e.code}")
        print(f"Error: {error_body[:500]}")
        return False, error_body
    except urllib.error.URLError as e:
        print(f"\n❌ URL ERROR: {str(e)}")
        return False, str(e)
    except Exception as e:
        print(f"\n❌ ERROR: {str(e)}")
        return False, str(e)

def main():
    """Main function to test all image formats"""
    print("\n" + "="*60)
    print("Image Format Test for qwen3.5-122b-a10b")
    print("="*60)
    print(f"API URL: {API_URL}")
    print(f"Model: qwen3.5-122b-a10b")
    
    # Test different formats
    formats = ['PNG', 'JPEG', 'WEBP']
    results = {}
    
    for fmt in formats:
        success, result = test_image_format(fmt)
        results[fmt] = {
            'success': success,
            'result': result
        }
    
    # Print summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    
    for fmt, res in results.items():
        status = "✅ PASS" if res['success'] else "❌ FAIL"
        print(f"{fmt:10} {status}")
    
    # Find the best format
    working_formats = [fmt for fmt, res in results.items() if res['success']]
    
    if working_formats:
        print(f"\n✅ Recommended format(s): {', '.join(working_formats)}")
    else:
        print("\n❌ No format works! The model may not support vision.")

if __name__ == "__main__":
    main()
