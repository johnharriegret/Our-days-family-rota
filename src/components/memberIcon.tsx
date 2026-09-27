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
}: {
  icon: string;
  colorToken: string;
  size?: number;
}) {
  const Icon = ICONS[icon] ?? User;
  return (
    <div className={`avatar member-${colorToken}`}>
      <Icon size={size} />
    </div>
  );
}
