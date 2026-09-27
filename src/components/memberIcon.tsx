import { Briefcase, GraduationCap, Heart, User, Users } from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  dad: Briefcase,
  mum: Heart,
  child: GraduationCap,
  family: Users,
};

export function MemberAvatar({
  icon,
  colorToken,
  size = 18,
  color,
}: {
  icon: string;
  colorToken: string;
  size?: number;
  /** Overrides the palette-token colour with an explicit hex (e.g. a parent's
   * quick-fill day/night colour). Falls back to the token-based CSS class
   * when omitted, so existing callers are unaffected. */
  color?: string | null;
}) {
  const Icon = ICONS[icon] ?? User;
  if (color) {
    return (
      <div className="avatar" style={{ background: `${color}22`, color }}>
        <Icon size={size} />
      </div>
    );
  }
  return (
    <div className={`avatar member-${colorToken}`}>
      <Icon size={size} />
    </div>
  );
}
