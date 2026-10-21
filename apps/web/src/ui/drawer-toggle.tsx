export interface DrawerToggleProps {
  id: string;
}

export function DrawerToggle({ id }: DrawerToggleProps) {
  return <input id={id} type="checkbox" className="drawer-toggle inline" />;
}
