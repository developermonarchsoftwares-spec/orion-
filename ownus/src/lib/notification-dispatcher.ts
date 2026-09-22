import { queryDb } from '@/lib/db';
import { sendPreferenceNotificationEmail } from '@/lib/email-service';

export type NotificationType =
  | 'emailNewBusinesses'
  | 'savedSearchAlerts'
  | 'creditLowWarning'
  | 'weeklyDigest'
  | 'productUpdates'
  | 'marketingEmails';

export interface DispatchNotificationParams {
  userId: string;
  email?: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  forceEmail?: boolean;
}

export interface DispatchNotificationResult {
  dispatched: boolean;
  emailSent: boolean;
  reason?: string;
  notification?: {
    id: string;
    title: string;
    message: string;
    time: string;
    timestamp: number;
    read: boolean;
    type: string;
    link?: string;
  };
}

/**
 * Checks user notification preferences stored in Neon PostgreSQL (users.metadata -> 'notifications').
 * If the preference for `type` is enabled (true), dispatches the notification and sends email via Resend API.
 * If disabled (false), suppresses dispatch cleanly.
 */
export async function dispatchUserNotification(
  params: DispatchNotificationParams
): Promise<DispatchNotificationResult> {
  const { userId, email, type, title, message, link, forceEmail } = params;

  try {
    // 1. Fetch user & metadata from Neon PostgreSQL database
    const rows = await queryDb(
      `SELECT id, email, first_name, display_name, metadata FROM users WHERE id = $1 OR (email IS NOT NULL AND LOWER(email) = LOWER($2)) LIMIT 1`,
      [userId || '00000000-0000-0000-0000-000000000000', email ? email.toLowerCase() : '']
    );

    const user = rows[0];
    if (!user) {
      return { dispatched: false, emailSent: false, reason: 'USER_NOT_FOUND' };
    }

    const metadata = (user.metadata as Record<string, any>) || {};
    const userNotifPrefs = metadata.notifications || {};

    // 2. Evaluate preference state from Neon PostgreSQL
    const defaultPrefs: Record<NotificationType, boolean> = {
      emailNewBusinesses: true,
      savedSearchAlerts: true,
      creditLowWarning: true,
      weeklyDigest: false,
      productUpdates: true,
      marketingEmails: false,
    };

    const isEnabled = userNotifPrefs[type] !== undefined ? Boolean(userNotifPrefs[type]) : defaultPrefs[type];

    if (!isEnabled && !forceEmail) {
      console.log(`[NOTIFICATION_DISPATCHER] Suppressed notification type '${type}' for user ${user.email} per database preference.`);
      return {
        dispatched: false,
        emailSent: false,
        reason: `PREFERENCE_DISABLED: User has disabled '${type}' in settings`,
      };
    }

    // 3. Construct Notification Object
    const notifObj = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      title,
      message,
      time: 'Just now',
      timestamp: Date.now(),
      read: false,
      type: type === 'creditLowWarning' ? 'credit' : type === 'savedSearchAlerts' ? 'lead' : 'system',
      link: link || '/dashboard',
    };

    // 4. Send Email via Resend API if recipient email is available
    let emailSent = false;
    const recipientEmail = user.email || email;

    if (recipientEmail) {
      const emailRes = await sendPreferenceNotificationEmail({
        email: recipientEmail,
        name: user.display_name || user.first_name || recipientEmail.split('@')[0],
        title,
        message,
        type,
        link: link || '/dashboard',
      });
      emailSent = emailRes.success;
    }

    console.log(`[NOTIFICATION_DISPATCHER] Dispatched notification type '${type}' to ${recipientEmail} (Email sent: ${emailSent})`);

    return {
      dispatched: true,
      emailSent,
      notification: notifObj,
    };
  } catch (err: any) {
    console.error(`[NOTIFICATION_DISPATCHER] Error dispatching notification '${type}':`, err.message);
    return {
      dispatched: false,
      emailSent: false,
      reason: err.message,
    };
  }
}
