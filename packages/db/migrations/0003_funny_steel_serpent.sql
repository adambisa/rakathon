ALTER TABLE "auth"."user" ADD COLUMN "display_email" text;
--> statement-breakpoint
UPDATE "auth"."user" SET "display_email" = btrim("email");
--> statement-breakpoint
CREATE TEMP TABLE canonical_auth_emails ON COMMIT DROP AS
WITH parts AS (
  SELECT id, lower(split_part(btrim(email), '@', 1)) AS local_part,
    lower(split_part(btrim(email), '@', 2)) AS domain
  FROM "auth"."user"
)
SELECT id,
  CASE
    WHEN domain IN ('gmail.com', 'googlemail.com') THEN replace(split_part(local_part, '+', 1), '.', '')
    WHEN domain IN ('icloud.com', 'me.com', 'hotmail.at', 'hotmail.be', 'hotmail.ca', 'hotmail.cl', 'hotmail.co.il', 'hotmail.co.nz', 'hotmail.co.th', 'hotmail.co.uk', 'hotmail.com', 'hotmail.com.ar', 'hotmail.com.au', 'hotmail.com.br', 'hotmail.com.gr', 'hotmail.com.mx', 'hotmail.com.pe', 'hotmail.com.tr', 'hotmail.com.vn', 'hotmail.cz', 'hotmail.de', 'hotmail.dk', 'hotmail.es', 'hotmail.fr', 'hotmail.hu', 'hotmail.id', 'hotmail.ie', 'hotmail.in', 'hotmail.it', 'hotmail.jp', 'hotmail.kr', 'hotmail.lv', 'hotmail.my', 'hotmail.ph', 'hotmail.pt', 'hotmail.sa', 'hotmail.sg', 'hotmail.sk', 'live.be', 'live.co.uk', 'live.com', 'live.com.ar', 'live.com.mx', 'live.de', 'live.es', 'live.eu', 'live.fr', 'live.it', 'live.nl', 'msn.com', 'outlook.at', 'outlook.be', 'outlook.cl', 'outlook.co.il', 'outlook.co.nz', 'outlook.co.th', 'outlook.com', 'outlook.com.ar', 'outlook.com.au', 'outlook.com.br', 'outlook.com.gr', 'outlook.com.pe', 'outlook.com.tr', 'outlook.com.vn', 'outlook.cz', 'outlook.de', 'outlook.dk', 'outlook.es', 'outlook.fr', 'outlook.hu', 'outlook.id', 'outlook.ie', 'outlook.in', 'outlook.it', 'outlook.jp', 'outlook.kr', 'outlook.lv', 'outlook.my', 'outlook.ph', 'outlook.pt', 'outlook.sa', 'outlook.sg', 'outlook.sk', 'passport.com') THEN split_part(local_part, '+', 1)
    WHEN domain IN ('rocketmail.com', 'yahoo.ca', 'yahoo.co.uk', 'yahoo.com', 'yahoo.de', 'yahoo.fr', 'yahoo.in', 'yahoo.it', 'ymail.com') THEN regexp_replace(local_part, '-[^-]*$', '')
    ELSE local_part
  END || '@' || CASE
    WHEN domain IN ('gmail.com', 'googlemail.com') THEN 'gmail.com'
    WHEN domain IN ('yandex.ru', 'yandex.ua', 'yandex.kz', 'yandex.com', 'yandex.by', 'ya.ru') THEN 'yandex.ru'
    ELSE domain
  END AS email
FROM parts;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM canonical_auth_emails GROUP BY email HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Email aliases collide. Resolve duplicate auth accounts before applying this migration.';
  END IF;
END $$;
--> statement-breakpoint
UPDATE "auth"."user" AS users SET email = canonical.email
FROM canonical_auth_emails AS canonical WHERE users.id = canonical.id;
--> statement-breakpoint
ALTER TABLE "auth"."user" ALTER COLUMN "display_email" SET NOT NULL;
