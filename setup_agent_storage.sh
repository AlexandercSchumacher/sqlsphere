#!/bin/bash
# Script to setup Supabase Storage for Agent Downloads
# Requires: supabase CLI installed and logged in

echo "🚀 Setting up Supabase Storage for Agent Downloads..."

# Check if supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Install it with:"
    echo "   npm install -g supabase"
    exit 1
fi

# Create storage bucket (if it doesn't exist)
echo "📦 Creating storage bucket 'agent-downloads'..."
supabase storage create agent-downloads --public

# Upload agent files (if they exist)
if [ -f "dist/SQLSphere-Agent.exe" ]; then
    echo "📤 Uploading Windows agent..."
    supabase storage upload agent-downloads SQLSphere-Agent-Windows.exe dist/SQLSphere-Agent.exe
fi

if [ -f "dist/SQLSphere-Agent" ]; then
    echo "📤 Uploading Mac/Linux agent..."
    supabase storage upload agent-downloads SQLSphere-Agent-Mac dist/SQLSphere-Agent
    # Also upload as Linux version
    supabase storage upload agent-downloads SQLSphere-Agent-Linux dist/SQLSphere-Agent
fi

echo "✅ Done! Get your public URLs from Supabase Dashboard → Storage → agent-downloads"

