# local_agent_manager.py
# Manages local database agents and their connections

import asyncio
import json
import secrets
import time
from typing import Dict, Optional, List
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
from enum import Enum
import logging

logger = logging.getLogger(__name__)

class AgentStatus(Enum):
    DISCONNECTED = "disconnected"
    CONNECTED = "connected"
    EXECUTING = "executing"
    ERROR = "error"

@dataclass
class AgentConnection:
    """Represents a connected local agent."""
    connection_code: str
    websocket: Optional[any] = None
    status: AgentStatus = AgentStatus.DISCONNECTED
    last_heartbeat: Optional[datetime] = None
    db_type: Optional[str] = None
    db_name: Optional[str] = None
    user_id: Optional[str] = None
    created_at: datetime = None
    
    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now()

@dataclass
class Job:
    """Represents a SQL job to be executed by an agent."""
    job_id: str
    connection_code: str
    sql: str
    created_at: datetime
    status: str = "pending"  # pending, executing, completed, failed
    result: Optional[Dict] = None
    error: Optional[str] = None
    completed_at: Optional[datetime] = None

class LocalAgentManager:
    """Manages local database agents and their connections."""
    
    def __init__(self):
        # Map connection_code -> AgentConnection
        self.agents: Dict[str, AgentConnection] = {}

        # Map job_id -> Job
        self.jobs: Dict[str, Job] = {}

        # Map connection_code -> List[job_id]
        self.pending_jobs: Dict[str, List[str]] = {}

        # Cleanup task
        self._cleanup_task = None

        # Reference to the main asyncio event loop (set at startup)
        self.main_loop: Optional[asyncio.AbstractEventLoop] = None

    def set_main_loop(self, loop: asyncio.AbstractEventLoop):
        """Store a reference to the main event loop for thread-safe WebSocket access."""
        self.main_loop = loop
        logger.info("Main event loop captured for thread-safe WebSocket access")

    def send_job_threadsafe(self, connection_code: str, job, timeout: float = 5) -> bool:
        """Send a job to an agent from any thread by scheduling on the main event loop.

        This is safe to call from sync endpoints running in worker threads.
        """
        if not self.main_loop or self.main_loop.is_closed():
            logger.error("Main event loop not available for thread-safe send")
            return False

        future = asyncio.run_coroutine_threadsafe(
            self.send_job_to_agent(connection_code, job),
            self.main_loop
        )
        try:
            return future.result(timeout=timeout)
        except Exception as e:
            logger.error(f"Thread-safe send failed for job {job.job_id}: {e}")
            return False
        
    def generate_connection_code(self) -> str:
        """Generate a unique connection code for a new agent."""
        while True:
            code = secrets.token_urlsafe(16)[:24]  # 24 character code
            if code not in self.agents:
                return code
    
    def register_agent(self, connection_code: str, websocket, db_type: Optional[str] = None, db_name: Optional[str] = None, user_id: Optional[str] = None) -> AgentConnection:
        """Register a new agent connection."""
        agent = AgentConnection(
            connection_code=connection_code,
            websocket=websocket,
            status=AgentStatus.CONNECTED,
            last_heartbeat=datetime.now(),
            db_type=db_type,
            db_name=db_name,
            user_id=user_id
        )
        self.agents[connection_code] = agent
        logger.info(f"Agent registered: {connection_code}")
        return agent
    
    def disconnect_agent(self, connection_code: str):
        """Disconnect an agent."""
        if connection_code in self.agents:
            self.agents[connection_code].status = AgentStatus.DISCONNECTED
            self.agents[connection_code].websocket = None
            logger.info(f"Agent disconnected: {connection_code}")
    
    def update_heartbeat(self, connection_code: str):
        """Update agent heartbeat."""
        if connection_code in self.agents:
            self.agents[connection_code].last_heartbeat = datetime.now()
    
    def get_agent(self, connection_code: str) -> Optional[AgentConnection]:
        """Get agent by connection code."""
        return self.agents.get(connection_code)
    
    def create_job(self, connection_code: str, sql: str) -> Job:
        """Create a new SQL job."""
        job_id = secrets.token_urlsafe(16)[:32]
        job = Job(
            job_id=job_id,
            connection_code=connection_code,
            sql=sql,
            created_at=datetime.now()
        )
        self.jobs[job_id] = job
        
        # Add to pending jobs queue
        if connection_code not in self.pending_jobs:
            self.pending_jobs[connection_code] = []
        self.pending_jobs[connection_code].append(job_id)
        
        logger.info(f"Job created: {job_id} for agent {connection_code}")
        return job
    
    def get_job(self, job_id: str) -> Optional[Job]:
        """Get job by ID."""
        return self.jobs.get(job_id)
    
    def complete_job(self, job_id: str, result: Optional[Dict] = None, error: Optional[str] = None):
        """Mark a job as completed."""
        if job_id not in self.jobs:
            logger.warning(f"Job {job_id} not found in jobs dictionary")
            return
        
        job = self.jobs[job_id]
        job.status = "completed" if error is None else "failed"
        job.result = result
        job.error = error
        job.completed_at = datetime.now()
        
        # Remove from pending jobs
        if job.connection_code in self.pending_jobs:
            if job_id in self.pending_jobs[job.connection_code]:
                self.pending_jobs[job.connection_code].remove(job_id)
        
        logger.info(f"Job completed: {job_id} (status: {job.status}, has_result: {result is not None}, has_error: {error is not None})")
    
    def get_pending_jobs(self, connection_code: str) -> List[Job]:
        """Get pending jobs for an agent."""
        if connection_code not in self.pending_jobs:
            return []
        
        jobs = []
        for job_id in self.pending_jobs[connection_code]:
            job = self.jobs.get(job_id)
            if job and job.status == "pending":
                jobs.append(job)
        return jobs
    
    async def send_job_to_agent(self, connection_code: str, job: Job) -> bool:
        """Send a job to an agent via WebSocket. Must be called from the WebSocket handler's event loop."""
        agent = self.get_agent(connection_code)
        if not agent or not agent.websocket:
            logger.warning(f"Agent {connection_code} not connected, cannot send job {job.job_id}")
            return False
        
        try:
            # Check if websocket is still connected
            if agent.status != AgentStatus.CONNECTED:
                logger.warning(f"Agent {connection_code} status is {agent.status}, cannot send job {job.job_id}")
                return False
            
            # Check if websocket is actually open
            if hasattr(agent.websocket, 'closed') and agent.websocket.closed:
                logger.warning(f"Agent {connection_code} websocket is closed, cannot send job {job.job_id}")
                self.disconnect_agent(connection_code)
                return False
            
            message = {
                "type": "job",
                "job_id": job.job_id,
                "sql": job.sql
            }
            
            logger.info(f"Attempting to send job {job.job_id} to agent {connection_code} (SQL: {job.sql[:50]}...)")
            
            # Send the message
            await agent.websocket.send_json(message)
            
            # Double-check connection is still open after sending
            if hasattr(agent.websocket, 'closed') and agent.websocket.closed:
                logger.warning(f"WebSocket closed immediately after sending job {job.job_id}")
                self.disconnect_agent(connection_code)
                job.status = "failed"
                job.error = "WebSocket closed after sending job"
                return False
            
            # Only mark as executing if send was successful
            job.status = "executing"
            logger.info(f"Job {job.job_id} successfully sent to agent {connection_code} and marked as executing")
            return True
        except Exception as e:
            error_msg = str(e).lower()
            logger.error(f"Failed to send job {job.job_id} to agent {connection_code}: {str(e)} (type: {type(e).__name__})")
            # Mark agent as disconnected if send fails (closed, close message, etc.)
            if "websocket" in error_msg or "closed" in error_msg or "connection" in error_msg or "close message" in error_msg:
                logger.warning(f"Marking agent {connection_code} as disconnected due to send failure")
                self.disconnect_agent(connection_code)
            job.status = "failed"
            job.error = error_msg
            return False
    
    async def cleanup_stale_agents(self):
        """Clean up agents that haven't sent a heartbeat in 5 minutes."""
        while True:
            try:
                now = datetime.now()
                stale_threshold = timedelta(minutes=5)
                
                to_remove = []
                for code, agent in self.agents.items():
                    # Only remove agents that are disconnected or haven't sent a heartbeat
                    # Don't remove agents that are currently connected (have active websocket)
                    if agent.status == AgentStatus.DISCONNECTED:
                        # Already disconnected, can be removed
                        to_remove.append(code)
                    elif agent.last_heartbeat:
                        # Check if heartbeat is stale AND websocket is not active
                        if now - agent.last_heartbeat > stale_threshold:
                            # Only remove if websocket is closed or None
                            if agent.websocket is None or (hasattr(agent.websocket, 'closed') and agent.websocket.closed):
                                to_remove.append(code)
                    elif agent.websocket is None or (hasattr(agent.websocket, 'closed') and agent.websocket.closed):
                        # No heartbeat and no websocket - remove
                        to_remove.append(code)
                
                for code in to_remove:
                    logger.info(f"Removing stale agent: {code}")
                    self.disconnect_agent(code)
                
                # Clean up old jobs (older than 1 hour)
                job_cleanup_threshold = timedelta(hours=1)
                to_remove_jobs = []
                for job_id, job in self.jobs.items():
                    if job.completed_at and now - job.completed_at > job_cleanup_threshold:
                        to_remove_jobs.append(job_id)
                
                for job_id in to_remove_jobs:
                    del self.jobs[job_id]
                
            except Exception as e:
                logger.error(f"Error in cleanup task: {e}")
            
            await asyncio.sleep(60)  # Run cleanup every minute
    
    def start_cleanup_task(self):
        """Start the cleanup task."""
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self.cleanup_stale_agents())

# Global instance
agent_manager = LocalAgentManager()

