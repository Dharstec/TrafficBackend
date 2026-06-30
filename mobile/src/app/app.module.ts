import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { LoginPage } from './pages/login/login.page';
import { HomePage } from './pages/home/home.page';
import { MapPage } from './pages/map/map.page';
import { IncidentPage } from './pages/incident/incident.page';

@NgModule({
  declarations: [AppComponent, LoginPage, HomePage, MapPage, IncidentPage],
  imports: [
    BrowserModule,
    CommonModule,
    FormsModule,
    HttpClientModule,
    IonicModule.forRoot(),
    AppRoutingModule,
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
