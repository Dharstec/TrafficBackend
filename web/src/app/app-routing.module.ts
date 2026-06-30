import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './core/guards/auth.guard';
import { LoginComponent } from './pages/login/login.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { LiveMonitorComponent } from './pages/live-monitor/live-monitor.component';
import { MapViewComponent } from './pages/map-view/map-view.component';
import { JunctionsComponent } from './pages/junctions/junctions.component';
import { OfficersComponent } from './pages/officers/officers.component';

const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [AuthGuard] },
  { path: 'live-monitor', component: LiveMonitorComponent, canActivate: [AuthGuard] },
  { path: 'map', component: MapViewComponent, canActivate: [AuthGuard] },
  { path: 'junctions', component: JunctionsComponent, canActivate: [AuthGuard] },
  { path: 'officers', component: OfficersComponent, canActivate: [AuthGuard] },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: 'dashboard' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
