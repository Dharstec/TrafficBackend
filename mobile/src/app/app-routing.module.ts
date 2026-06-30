import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginPage } from './pages/login/login.page';
import { HomePage } from './pages/home/home.page';
import { MapPage } from './pages/map/map.page';
import { IncidentPage } from './pages/incident/incident.page';

const routes: Routes = [
  { path: 'login', component: LoginPage },
  { path: 'home', component: HomePage },
  { path: 'map', component: MapPage },
  { path: 'incident', component: IncidentPage },
  { path: '', redirectTo: 'home', pathMatch: 'full' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
