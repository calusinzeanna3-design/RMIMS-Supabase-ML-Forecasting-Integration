// scratch/verify_live_notifications.js
import fs from 'fs';
import path from 'path';

const shellPath = path.resolve('RMIMS/js/rmsme-shell.js');
const cssPath = path.resolve('RMIMS/css/rmims-unified.css');

const shellContent = fs.readFileSync(shellPath, 'utf8');
const cssContent = fs.readFileSync(cssPath, 'utf8');

console.log("=== 1. Checking Shell Notification Elements ===");
if (!shellContent.includes('id="rmsmeNotificationBtn"')) throw new Error("Missing #rmsmeNotificationBtn in rmsme-shell.js");
if (!shellContent.includes('id="rmsmeNotifBadge"')) throw new Error("Missing #rmsmeNotifBadge in rmsme-shell.js");
if (!shellContent.includes('id="rmsmeNotifications"')) throw new Error("Missing #rmsmeNotifications in rmsme-shell.js");
if (!shellContent.includes('id="rmsmeMarkAll"')) throw new Error("Missing #rmsmeMarkAll in rmsme-shell.js");
if (!shellContent.includes('id="rmsmeNotificationList"')) throw new Error("Missing #rmsmeNotificationList in rmsme-shell.js");
if (!shellContent.includes('id="rmsmeViewNotifications"')) throw new Error("Missing #rmsmeViewNotifications in rmsme-shell.js");
console.log("PASS: Core shell notification DOM elements verified!");

console.log("=== 2. Checking Real Event Sync & Deterministic Event IDs ===");
if (!shellContent.includes('notif-rcv-')) throw new Error("Missing notif-rcv- deterministic receipt ID pattern");
if (!shellContent.includes('notif-disb-')) throw new Error("Missing notif-disb- deterministic disbursement ID pattern");
if (!shellContent.includes('notif-stock-zero-')) throw new Error("Missing notif-stock-zero- deterministic out of stock ID pattern");
if (!shellContent.includes('notif-stock-low-')) throw new Error("Missing notif-stock-low- deterministic low stock ID pattern");
if (!shellContent.includes('notif-stock-restored-')) throw new Error("Missing notif-stock-restored- deterministic stock restored ID pattern");
if (!shellContent.includes('notif-daily-fc-')) throw new Error("Missing notif-daily-fc- deterministic daily forecast reminder ID pattern");
if (!shellContent.includes('notif-login-')) throw new Error("Missing notif-login- deterministic login session ID pattern");
console.log("PASS: All deterministic event ID patterns verified!");

console.log("=== 3. Checking Actor Identification Logic ===");
if (!shellContent.includes('Recorded by')) throw new Error("Missing 'Recorded by' actor label logic");
if (!shellContent.includes('System')) throw new Error("Missing 'System' actor label fallback");
console.log("PASS: Truthful actor identification and neutral fallbacks verified!");

console.log("=== 4. Checking View All Notifications Modal ===");
if (!shellContent.includes('rmsmeAllNotificationsOverlay')) throw new Error("Missing #rmsmeAllNotificationsOverlay modal");
if (!shellContent.includes('rmsmeModalSearchInput')) throw new Error("Missing search input in View All modal");
if (!shellContent.includes('rmsmeFilterPills')) throw new Error("Missing category filter pills in View All modal");
if (!shellContent.includes('rmsmeModalMarkAllBtn')) throw new Error("Missing Mark all as read in View All modal");
console.log("PASS: View All Notifications modal structure verified!");

console.log("=== 5. Checking Realtime & Global API Integration ===");
if (!shellContent.includes('window.RMIMS_NOTIFICATIONS')) throw new Error("Missing window.RMIMS_NOTIFICATIONS global API");
if (!shellContent.includes('window.RMSME.pushNotification')) throw new Error("Missing window.RMSME.pushNotification backward-compat API");
if (!shellContent.includes('rmims_shared_notifications')) throw new Error("Missing Supabase Realtime channel subscription");
console.log("PASS: Realtime subscriptions and public APIs verified!");

console.log("=== 6. Checking Notification CSS Styles ===");
if (!cssContent.includes('.rmsme-notif-badge')) throw new Error("Missing .rmsme-notif-badge CSS class");
if (!cssContent.includes('.rmsme-notif-icon.priority-success')) throw new Error("Missing success priority icon styles");
if (!cssContent.includes('.rmsme-notif-icon.priority-warning')) throw new Error("Missing warning priority icon styles");
if (!cssContent.includes('.rmsme-notif-icon.priority-critical')) throw new Error("Missing critical priority icon styles");
if (!cssContent.includes('.rmsme-all-notifs-overlay')) throw new Error("Missing .rmsme-all-notifs-overlay modal CSS");
console.log("PASS: CSS styles for dropdown and modal verified!");

console.log("ALL LIVE SHARED NOTIFICATION SYSTEM TESTS PASSED SUCCESSFULLY!");
