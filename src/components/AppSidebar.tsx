import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from "@/components/ui/sidebar";

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader />
      <SidebarContent>
        <SidebarGroup>
          <div>Shit</div>
        </SidebarGroup>
        <SidebarGroup />
      </SidebarContent>
      <SidebarFooter color="blue" />
    </Sidebar>
  );
}
