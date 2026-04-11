import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { inlineImagesInHtml } from './converter';

vi.mock('fs');

describe('inlineImagesInHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should inline remote images fetching them and converting to base64', async () => {
    const html = '<html><body><img src="https://example.com/image.png" /></body></html>';
    
    // Mock the global fetch API to simulate downloading an image
    const mockResponse = {
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)), // 8 bytes of empty data
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const result = await inlineImagesInHtml(html, '/tmp');
    
    // An 8-byte ArrayBuffer of zeros encodes to 'AAAAAAAAAAA=' in Base64
    expect(result).toContain('data:image/png;base64,AAAAAAAAAAA=');
    expect(global.fetch).toHaveBeenCalledWith('https://example.com/image.png');
  });

  it('should inline local images by reading from the file system', async () => {
    const html = '<html><body><img src="local.jpg" /></body></html>';
    
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    // Mock reading local file system to return a buffer
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]) as any);

    const result = await inlineImagesInHtml(html, '/tmp');
    
    // mime-types lookup should correctly identify local.jpg as image/jpeg
    expect(result).toContain('data:image/jpeg;base64,AAAAAAAAAAA=');
    expect(fs.readFileSync).toHaveBeenCalledWith(expect.stringContaining('local.jpg'));
  });

  it('should leave already inlined base64 data URIs untouched', async () => {
    const html = '<html><body><img src="data:image/png;base64,existing" /></body></html>';
    
    const result = await inlineImagesInHtml(html, '/tmp');
    
    expect(result).toContain('data:image/png;base64,existing');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('should skip remote images if fetch fails', async () => {
    const html = '<html><body><img src="https://example.com/notfound.png" /></body></html>';
    
    const mockResponse = {
      ok: false,
      status: 404
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const result = await inlineImagesInHtml(html, '/tmp');
    
    // Should remain unchanged because it failed
    expect(result).toContain('src="https://example.com/notfound.png"');
  });
});