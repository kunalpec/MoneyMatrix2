#!/bin/bash
# MongoDB Automated Backup Script
# Add to crontab: 0 2 * * * /var/www/moneymatrix/backend/backup-mongodb.sh

set -e

BACKUP_DIR="/backups/mongodb"
MONGO_URI="${MONGO_URI}"
BACKUP_DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="$BACKUP_DIR/backup_$BACKUP_DATE.archive"
LOG_FILE="/var/log/moneymatrix/backup.log"

# Create backup directory
mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting MongoDB backup..." >> "$LOG_FILE"

# Create backup using mongodump
mongodump \
    --uri="$MONGO_URI" \
    --archive="$BACKUP_FILE" \
    --gzip \
    2>> "$LOG_FILE"

if [ $? -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup successful: $BACKUP_FILE" >> "$LOG_FILE"
    
    # Keep only last 30 days of backups
    find "$BACKUP_DIR" -name "backup_*.archive" -mtime +30 -delete
    
    # Optional: Upload to S3 or cloud storage
    # aws s3 cp "$BACKUP_FILE" "s3://your-bucket/backups/"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup FAILED!" >> "$LOG_FILE"
    exit 1
fi
