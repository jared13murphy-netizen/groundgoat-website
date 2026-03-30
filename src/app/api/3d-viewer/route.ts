import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const tractId = request.nextUrl.searchParams.get('tractId');

  if (!token || !tractId) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // Verify token is valid by calling the backend
  try {
    const verifyResponse = await fetch(`${API_URL}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    
    if (!verifyResponse.ok) {
      return new NextResponse('Unauthorized - invalid token', { status: 401 });
    }
  } catch {
    return new NextResponse('Authentication failed', { status: 401 });
  }

  // Token is valid - serve the 3D viewer HTML
  // Read from the backend's static file or embed inline
  try {
    const viewerResponse = await fetch(`${API_URL}/static/3d-viewer.html`);
    if (!viewerResponse.ok) {
      return new NextResponse('Viewer not available', { status: 500 });
    }
    
    let html = await viewerResponse.text();
    
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch {
    return new NextResponse('Failed to load viewer', { status: 500 });
  }
}
