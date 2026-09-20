"""
Bot Framework Adapter for Voice Agent
Thin adapter layer that connects Bot Framework to the existing agent_engine.py logic.
"""
import logging
from botbuilder.core import ActivityHandler, TurnContext
from botbuilder.schema import ChannelAccount, ActivityTypes
from shared_code.agent.agent_engine import run_agent_step

logger = logging.getLogger("voicecs-bot")


class VoiceAgentBot(ActivityHandler):
    """
    Bot Framework adapter for the voice agent.
    Receives text messages from Direct Line Speech and forwards to agent_engine.
    """

    async def on_message_activity(self, turn_context: TurnContext):
        """
        Handle incoming message (user speech already transcribed by Direct Line Speech).
        
        Args:
            turn_context: Bot Framework turn context containing the message
        """
        # Extract session ID from conversation
        session_id = turn_context.activity.conversation.id
        
        # Get user's text (already transcribed by Direct Line Speech)
        user_text = turn_context.activity.text
        
        logger.info(f"[Session: {session_id}] User said: {user_text}")
        
        # Call existing agent logic (unchanged)
        agent_reply = run_agent_step(session_id=session_id, text=user_text)
        
        # Extract response text
        reply_text = agent_reply.get("prompt", "I'm sorry, I didn't catch that.")
        
        logger.info(f"[Session: {session_id}] Agent reply: {reply_text}")
        
        # Send response (Bot Framework converts to TTS automatically via Direct Line Speech)
        await turn_context.send_activity(reply_text)

    async def on_conversation_update_activity(self, turn_context: TurnContext):
        """
        Handle conversation start/end events.
        
        Args:
            turn_context: Bot Framework turn context
        """
        # Handle call start (when user joins conversation)
        if turn_context.activity.members_added:
            for member in turn_context.activity.members_added:
                # Don't greet the bot itself
                if member.id != turn_context.activity.recipient.id:
                    session_id = turn_context.activity.conversation.id
                    
                    logger.info(f"[Session: {session_id}] Call started, sending greeting")
                    
                    # Trigger greeting by sending "__start__" to agent
                    agent_reply = run_agent_step(
                        session_id=session_id,
                        text="__start__"
                    )
                    
                    greeting = agent_reply.get("prompt")
                    if greeting:
                        await turn_context.send_activity(greeting)
                        logger.info(f"[Session: {session_id}] Greeting sent: {greeting}")

    async def on_members_removed_activity(
        self, members_removed: list[ChannelAccount], turn_context: TurnContext
    ):
        """
        Handle conversation end (call disconnected).
        
        Args:
            members_removed: List of members who left
            turn_context: Bot Framework turn context
        """
        session_id = turn_context.activity.conversation.id
        logger.info(f"[Session: {session_id}] Call ended")
        
        # Session cleanup is handled automatically by the agent_engine
        # (sessions are stored with TTL or cleaned up periodically)

    async def on_turn(self, turn_context: TurnContext):
        """
        Main turn handler - called for every activity.
        
        Args:
            turn_context: Bot Framework turn context
        """
        # Log all activities for debugging
        activity_type = turn_context.activity.type
        session_id = turn_context.activity.conversation.id
        
        logger.debug(f"[Session: {session_id}] Activity type: {activity_type}")
        
        # Call parent handler which routes to specific handlers
        await super().on_turn(turn_context)
