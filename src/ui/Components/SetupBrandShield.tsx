import { ShieldCheck } from 'lucide-react';

type SetupBrandShieldSize = 'sm' | 'md' | 'lg';

interface SetupBrandShieldProps {
  size?: SetupBrandShieldSize;
  className?: string;
}

const SIZE_CLASSES: Record<SetupBrandShieldSize, {
  frame: string;
  ring: string;
  tile: string;
  icon: string;
}> = {
  sm: {
    frame: 'h-10 w-10',
    ring: 'h-10 w-10 rounded-xl',
    tile: 'h-9 w-9 rounded-xl',
    icon: 'h-4 w-4',
  },
  md: {
    frame: 'h-14 w-14',
    ring: 'h-14 w-14 rounded-2xl',
    tile: 'h-12 w-12 rounded-2xl',
    icon: 'h-6 w-6',
  },
  lg: {
    frame: 'h-24 w-24',
    ring: 'h-24 w-24 rounded-[30px]',
    tile: 'h-20 w-20 rounded-3xl',
    icon: 'h-10 w-10',
  },
};

function cx(...classes: Array<string | undefined | false>): string {
  return classes.filter(Boolean).join(' ');
}

export function SetupBrandShield({ size = 'sm', className }: SetupBrandShieldProps) {
  const sizeClass = SIZE_CLASSES[size];

  return (
    <div className={cx('relative flex shrink-0 items-center justify-center', sizeClass.frame, className)}>
      <div
        className={cx(
          'pointer-events-none absolute border border-accent-edge/70 opacity-70 animate-[pulseRing_2.2s_ease-out_infinite]',
          sizeClass.ring
        )}
      />
      <div
        className={cx(
          'relative flex items-center justify-center border border-accent-edge/60 bg-gradient-to-br from-indigo-500 to-purple-600 shadow-[0_6px_26px_rgba(99,102,241,0.42)]',
          sizeClass.tile
        )}
      >
        <ShieldCheck className={cx('text-white drop-shadow-sm', sizeClass.icon)} />
      </div>
    </div>
  );
}
