import { cc } from '@/utility/css';

export default function Badge({
  children,
  type = 'primary',
  uppercase,
}: {
  children: React.ReactNode
  type?: 'primary' | 'secondary' | 'text-only'
  uppercase?: boolean
}) {
  const baseStyles = () => {
    switch (type) {
    case 'primary': return cc(
      'px-1.5 py-[0.3rem] leading-none rounded-md',
      'bg-gray-100/80 dark:bg-gray-900/80',
      'border border-gray-200/60 dark:border-gray-800/75'
    );
    case 'secondary': return cc(
      'px-1.5 py-1 leading-none rounded-[0.25rem]',
      'bg-gray-100 dark:bg-gray-800/60',
      'text-medium',
      'font-medium text-[0.7rem]',
    );
    }
  };
  return (
    <span className={cc(
      baseStyles(),
      uppercase && 'uppercase tracking-wider',
    )}>
      {children}
    </span>
  );
}