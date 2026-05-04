#!/usr/bin/env python3
"""
Simple test script to test the local agent by submitting SQL queries via Supabase Edge Function.
This script uses the Supabase Edge Function which handles authentication automatically.

Usage: 
  python test_local_agent.py <supabase_url> <supabase_anon_key> <connection_code> <sql_query>

Example:
  python test_local_agent.py https://xxx.supabase.co xxx YOUR_CONNECTION_CODE "SELECT 1 as test"
"""

import sys
import requests
import time
import json

def test_local_agent(supabase_url: str, supabase_key: str, connection_code: str, sql_query: str):
    """Test the local agent by submitting a SQL query via Supabase Edge Function."""
    
    edge_function_url = f"{supabase_url}/functions/v1/database-proxy"
    
    # Step 1: Check agent status
    print(f"🔍 Checking agent status for connection code: {connection_code}")
    try:
        response = requests.post(
            edge_function_url,
            json={
                "endpoint": f"/api/local-agent/status/{connection_code}",
                "method": "GET"
            },
            headers={
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json"
            }
        )
        
        if response.status_code == 200:
            status_data = response.json()
            print(f"✅ Agent status: {status_data.get('status', 'unknown')}")
            if status_data.get('status') != 'connected':
                print(f"⚠️  Warning: Agent is not connected (status: {status_data.get('status')})")
        else:
            print(f"⚠️  Could not check agent status (HTTP {response.status_code})")
            print(f"   Response: {response.text}")
    except Exception as e:
        print(f"⚠️  Error checking agent status: {e}")
    
    # Step 2: Submit a job
    print(f"\n📤 Submitting SQL query: {sql_query}")
    try:
        response = requests.post(
            edge_function_url,
            json={
                "endpoint": "/api/local-agent/job",
                "method": "POST",
                "body": {
                    "connection_code": connection_code,
                    "sql": sql_query
                }
            },
            headers={
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json"
            }
        )
        
        if response.status_code == 200:
            job_data = response.json()
            job_id = job_data.get("job_id")
            print(f"✅ Job submitted successfully!")
            print(f"   Job ID: {job_id}")
            print(f"   Status: {job_data.get('status')}")
            print(f"   Sent: {job_data.get('sent')}")
            
            # Step 3: Poll for job result
            print(f"\n⏳ Waiting for job result...")
            max_wait = 30  # Maximum wait time in seconds
            start_time = time.time()
            
            while time.time() - start_time < max_wait:
                try:
                    result_response = requests.post(
                        edge_function_url,
                        json={
                            "endpoint": f"/api/local-agent/job/{job_id}",
                            "method": "GET"
                        },
                        headers={
                            "Authorization": f"Bearer {supabase_key}",
                            "Content-Type": "application/json"
                        }
                    )
                    
                    if result_response.status_code == 200:
                        result_data = result_response.json()
                        status = result_data.get("status")
                        
                        if status == "completed":
                            print(f"\n✅ Job completed!")
                            result = result_data.get("result")
                            if result and result.get("success"):
                                print(f"   Success: {result.get('success')}")
                                if "rows" in result:
                                    rows = result.get('rows', [])
                                    print(f"   Rows returned: {len(rows)}")
                                    if rows:
                                        print(f"\n   First few rows:")
                                        for i, row in enumerate(rows[:5]):
                                            print(f"   {i+1}: {row}")
                                if "columns" in result:
                                    print(f"   Columns: {result.get('columns')}")
                            else:
                                error = result_data.get("error") or (result.get("error") if result else None)
                                print(f"   ❌ Error: {error}")
                            break
                        elif status == "failed":
                            error = result_data.get("error", "Unknown error")
                            print(f"\n❌ Job failed: {error}")
                            break
                        elif status == "pending" or status == "running":
                            print(".", end="", flush=True)
                            time.sleep(1)
                        else:
                            print(f"\n⚠️  Unknown status: {status}")
                            break
                    else:
                        print(f"\n⚠️  Error getting job result (HTTP {result_response.status_code})")
                        print(f"   Response: {result_response.text}")
                        break
                except Exception as e:
                    print(f"\n⚠️  Error polling job result: {e}")
                    break
            
            if time.time() - start_time >= max_wait:
                print(f"\n⏱️  Timeout waiting for job result")
        else:
            print(f"❌ Failed to submit job (HTTP {response.status_code})")
            print(f"   Response: {response.text}")
            
    except Exception as e:
        print(f"❌ Error submitting job: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    if len(sys.argv) < 5:
        print("Usage: python test_local_agent.py <supabase_url> <supabase_anon_key> <connection_code> <sql_query>")
        print("\nExample:")
        print('  python test_local_agent.py https://xxx.supabase.co xxx YOUR_CONNECTION_CODE "SELECT 1 as test"')
        print('  python test_local_agent.py https://xxx.supabase.co xxx YOUR_CONNECTION_CODE "SHOW TABLES"')
        print("\nTo get your Supabase URL and anon key:")
        print("  1. Go to your Supabase project dashboard")
        print("  2. Go to Settings > API")
        print("  3. Copy the 'Project URL' and 'anon public' key")
        sys.exit(1)
    
    supabase_url = sys.argv[1]
    supabase_key = sys.argv[2]
    connection_code = sys.argv[3]
    sql_query = sys.argv[4]
    
    test_local_agent(supabase_url, supabase_key, connection_code, sql_query)

