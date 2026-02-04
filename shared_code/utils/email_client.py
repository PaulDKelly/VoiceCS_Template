import os
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logger = logging.getLogger("email-client")

def send_booking_email(session: dict, issue: str, address: str, recipient_email: str = None):
    """
    Sends a booking confirmation email with vehicle and customer details.
    """
    # 1. Get credentials from env
    smtp_server = os.getenv("SMTP_SERVER", "smtp.office365.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASSWORD")
    
    # Recipient: Argument > Env Var > Default
    recipient = recipient_email or os.getenv("BOOKING_RECIPIENT_EMAIL", "pauldkelly@outlook.com")
    
    # Check for Mock Mode
    if os.getenv("MOCK_EMAIL", "").lower() == "true":
        logger.info(f"MOCK EMAIL: Would fail to send to {recipient} via {smtp_server}")
        logger.info(f"Details: {issue}, {address}")
        return True
    
    if not smtp_user or not smtp_pass:
        logger.warning("SMTP credentials missing. Email NOT sent.")
        logger.info(f"--- MOCK EMAIL TO {recipient} ---\nIssue: {issue}\nName: {session.get('customer_name')}\nPhone: {session.get('phone_number')}\nAddress: {address}\n-----------------------------")
        return False

    try:
        msg = MIMEMultipart()
        msg['From'] = smtp_user
        msg['To'] = recipient
        
        # Use Booking Name if available
        name_to_use = session.get("service_booking_name") or session.get("customer_name") or "Unknown"
        
        msg['Subject'] = f"New Service Booking: {name_to_use}"

        body = (
            f"New Service Booking Request\n\n"
            f"Customer Name: {name_to_use}\n"
            f"Phone Number: {session.get('phone_number', 'Unknown')}\n"
            f"Address: {address}\n"
            f"Vehicle Purchase Date: {session.get('purchase_date', 'Unknown')}\n"
            f"Reported Issue:\n{issue}\n"
        )
        msg.attach(MIMEText(body, 'plain'))

        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()
        server.login(smtp_user, smtp_pass)
        text = msg.as_string()
        server.sendmail(smtp_user, recipient, text)
        server.quit()
        
        logger.info(f"Booking email sent to {recipient}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        return False

def send_generic_email(recipient_email: str, subject: str, body: str):
    """
    Sends a generic email with provided subject and body.
    """
    smtp_server = os.getenv("SMTP_SERVER", "smtp.office365.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASSWORD")
    
    recipient = recipient_email or os.getenv("BOOKING_RECIPIENT_EMAIL", "pauldkelly@outlook.com")

    if not smtp_user or not smtp_pass:
        logger.info(f"--- MOCK EMAIL TO {recipient} ---\nSubject: {subject}\nBody: {body}\n-----------------------------")
        return False

    try:
        msg = MIMEMultipart()
        msg['From'] = smtp_user
        msg['To'] = recipient
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))

        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_user, recipient, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        logger.error(f"Failed to send generic email: {e}")
        return False
