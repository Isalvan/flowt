import os
import base64
import logging
from typing import List, Dict, Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# If modifying these scopes, delete the file token.json.
SCOPES = ['https://www.googleapis.com/auth/gmail.modify']

logger = logging.getLogger(__name__)

def get_gmail_service():
    """Shows basic usage of the Gmail API.
    Lists the user's Gmail labels.
    """
    creds = None
    # The file token.json stores the user's access and refresh tokens, and is
    # created automatically when the authorization flow completes for the first
    # time.
    token_path = os.path.join(os.path.dirname(__file__), 'token.json')
    credentials_path = os.path.join(os.path.dirname(__file__), 'credentials.json')

    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)
    # If there are no (valid) credentials available, let the user log in.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(credentials_path):
                logger.error(f"Credentials file not found at {credentials_path}")
                return None
            
            # En entornos CI/CD (GitHub Actions) o Nube (GCP) no podemos abrir un navegador.
            # Si llegamos aquí es porque el token no existe o ha fallado el refresco.
            if os.getenv("K_SERVICE") or os.getenv("GITHUB_ACTIONS"):
                logger.error("Error: token.json no válido o inexistente en entorno remoto. No se puede realizar autenticación interactiva.")
                return None

            flow = InstalledAppFlow.from_client_secrets_file(
                credentials_path, SCOPES)
            creds = flow.run_local_server(port=0)
        
        # Save the credentials for the next run
        with open(token_path, 'w') as token:
            token.write(creds.to_json())

    try:
        service = build('gmail', 'v1', credentials=creds)
        return service
    except HttpError as error:
        logger.error(f'An error occurred: {error}')
        return None

def get_unread_emails_from_bank(bank_sender: str, max_results: int = 10) -> List[Dict[str, str]]:
    """
    Fetches unread emails from the specified bank sender.
    """
    service = get_gmail_service()
    if not service:
        return []

    try:
        query = f"is:unread from:{bank_sender}"
        results = service.users().messages().list(userId='me', q=query, maxResults=max_results).execute()
        messages = results.get('messages', [])

        emails = []
        for message in messages:
            msg = service.users().messages().get(userId='me', id=message['id'], format='full').execute()
            
            # Extract headers
            headers = msg['payload'].get('headers', [])
            subject = next((header['value'] for header in headers if header['name'].lower() == 'subject'), '')
            sender = next((header['value'] for header in headers if header['name'].lower() == 'from'), '')
            date_sent = next((header['value'] for header in headers if header['name'].lower() == 'date'), '')
            auth_results = next((header['value'] for header in headers if header['name'].lower() == 'authentication-results'), '')
            message_id = next((header['value'] for header in headers if header['name'].lower() == 'message-id'), message['id'])

            # Extract body
            body = ""
            if 'parts' in msg['payload']:
                for part in msg['payload']['parts']:
                    if part['mimeType'] == 'text/plain':
                        if 'data' in part['body']:
                            body = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8')
                            break
            elif 'body' in msg['payload'] and 'data' in msg['payload']['body']:
                body = base64.urlsafe_b64decode(msg['payload']['body']['data']).decode('utf-8')

            emails.append({
                "id": message['id'],
                "message_id": message_id,
                "from": sender,
                "subject": subject,
                "date_sent": date_sent,
                "auth_results": auth_results,
                "body": body
            })

        return emails
    except HttpError as error:
        logger.error(f'An error occurred: {error}')
        return []

def mark_email_as_read(message_id: str) -> bool:
    """
    Marks an email as read by removing the UNREAD label.
    """
    service = get_gmail_service()
    if not service:
        return False

    try:
        service.users().messages().modify(
            userId='me',
            id=message_id,
            body={'removeLabelIds': ['UNREAD']}
        ).execute()
        return True
    except HttpError as error:
        logger.error(f'An error occurred: {error}')
        return False
