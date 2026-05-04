# Claude Sonnet 4.5 Integration Setup

## Installation

1. Install the anthropic library:
```bash
pip install anthropic==0.39.0
```

Or install all requirements:
```bash
pip install -r requirements.txt
```

## Configuration

Set the environment variable for your Anthropic API key:

```bash
# Linux/macOS
export ANTHROPIC_API_KEY="your-api-key-here"
export ACTIVE_MODEL="claude"

# Windows (PowerShell)
$env:ANTHROPIC_API_KEY="your-api-key-here"
$env:ACTIVE_MODEL="claude"

# Windows (CMD)
set ANTHROPIC_API_KEY=your-api-key-here
set ACTIVE_MODEL=claude
```

## Get an API Key

1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Navigate to "API Keys" in the settings
4. Create a new API key
5. Copy the key and set it as the `ANTHROPIC_API_KEY` environment variable

## Model Information

- **Model**: claude-sonnet-4-20250514 (Claude Sonnet 4.5)
- **Max Tokens**: 8192 (for responses)
- **Temperature**: 0.3 (for consistent SQL generation)
- **Context Window**: ~200K tokens

## Switching Between Models

You can switch between different LLMs by changing the `ACTIVE_MODEL` environment variable:

- `claude` - Claude Sonnet 4.5 (default, recommended)
- `chatgpt` - GPT-4o-mini
- `gemini` - Gemini 1.5 Flash

## Benefits of Claude Sonnet 4.5

1. **Superior SQL Generation**: Better understanding of complex database operations
2. **Accurate Dialect Handling**: Excellent at following PostgreSQL/MySQL/SQL Server specific syntax
3. **JSON Compliance**: More reliable at returning properly formatted JSON responses
4. **Context Understanding**: Better at multi-step operations and maintaining context
5. **Cost Effective**: Good balance between performance and cost

## Verification

To verify the setup, start your application and check the logs:

```bash
python main.py
```

You should see the application start without errors. The first time a chat query is made, it will use Claude Sonnet 4.5.

