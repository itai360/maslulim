# מסלולים · שני ניסנבוים

דפי הצעת המסלולים ללקוחות. האתר רץ על **Vercel**, והתוכן, הקישורים והתמונות שמורים ב-**Supabase**.

- אתר: https://packages.shanissinboiem.com
- ניהול: https://packages.shanissinboiem.com/admin/

## איך זה עובד

| מה | איפה |
|---|---|
| טקסטים, מחירים, מסלולים (עברית + אנגלית) | Supabase · פרויקט **WebSite** · טבלאות `offer_pages` (דף לכל הצעה) ו-`offer_site` (תוכן משותף: אודות, תהליך, גלריה, פרטי קשר) |
| קישורים אישיים ללקוחות + תוקף + מעקב צפיות | טבלה `offer_links` |
| גרסאות קודמות (נשמרות אוטומטית בכל שמירה) | טבלה `offer_history` |
| תמונות | Supabase Storage · bucket `offer-media` |
| מי מורשה לנהל | טבלה `offer_admins` (לפי אימייל) |
| הקוד | הריפו הזה. כל push לענף `main` מתעדכן אוטומטית באתר (Vercel) |

קישור ללקוח נראה כך: `https://packages.shanissinboiem.com/<כתובת-הדף>?k=<קוד>`.
השרת (`api/page.js`) בודק את הקוד מול Supabase (`get_offer`). קישור שפג תוקפו או בוטל מציג את מסך "תוקף הקישור הסתיים" עם כפתור לוואטסאפ, ותוכן ההצעה לא נשלח בכלל.
פתיחה על ידי תצוגה מקדימה של וואטסאפ לא נספרת כצפייה.

## מבנה הקוד

```
api/page.js            עמוד הצעה (נבנה בשרת מהנתונים)
api/config.js          כתובת + מפתח ציבורי של Supabase לממשק הניהול
public/lib/render.js   בונה את ה-HTML של הדף (משותף לשרת ולתצוגה המקדימה בניהול)
public/assets/         העיצוב והסקריפט של הדף (זהים לדפים המקוריים)
public/admin/          ממשק הניהול
supabase/migrations/   מבנה מסד הנתונים
seed/                  התוכן כפי שהועבר מהקבצים המקוריים
legacy/                הקבצים המקוריים (ארכיון)
```

## הגדרות

משתני סביבה ב-Vercel: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (מפתח ציבורי; ההרשאות נאכפות ב-RLS).

הוספת מנהל/ת: ב-Supabase → SQL:

```sql
insert into public.offer_admins (email) values ('someone@example.com');
```
