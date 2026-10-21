import { useState } from "react";

import { avatarForName } from "#lib/avatar";
import { Tooltip } from "#ui";

interface UploadedByProps {
  user: { name: string; email: string; image?: string | null };
}

export function UploadedBy({ user }: UploadedByProps) {
  const [failedImage, setFailedImage] = useState<string>();
  let src = avatarForName(user.name);
  if (typeof user.image === "string" && user.image !== failedImage) src = user.image;

  return (
    <Tooltip tip={user.email}>
      <span className="inline-flex min-w-0 items-center gap-1.5 text-left">
        <img
          src={src}
          alt=""
          width={16}
          height={16}
          className="size-4 shrink-0 rounded-full object-cover outline-1 outline-base-300"
          referrerPolicy="no-referrer"
          onError={() => setFailedImage(src)}
        />
        <span className="truncate text-sm font-medium">{user.name}</span>
        <span className="sr-only"> ({user.email})</span>
      </span>
    </Tooltip>
  );
}
