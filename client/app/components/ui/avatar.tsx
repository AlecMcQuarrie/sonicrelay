interface AvatarProps {
  username: string;
  profilePhoto?: string | null;
  size?: "sm" | "md";
  className?: string;
}

export default function Avatar({ username, profilePhoto, size = "md", className = "" }: AvatarProps) {
  const sizeClass = size === "sm" ? "w-6 h-6 text-xs" : "w-8 h-8 text-sm";

  if (profilePhoto) {
    return (
      <img
        src={profilePhoto}
        alt={username}
        className={`${sizeClass} rounded-full object-cover shrink-0 ${className}`}
      />
    );
  }

  return (
    <div className={`${sizeClass} rounded-full bg-muted flex items-center justify-center shrink-0 font-medium text-muted-foreground ${className}`}>
      {username.charAt(0).toUpperCase()}
    </div>
  );
}
