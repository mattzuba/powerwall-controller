export class Battery {
  constructor (siteId, batteryInfo) {
    this._siteId = siteId;
    this._batteryInfo = batteryInfo;
  }

  isTou () {
    return this._batteryInfo.default_real_mode === 'autonomous';
  }

  peakSchedule () {
    if (!Array.isArray(this._batteryInfo?.tou_settings?.schedule)) {
      return [];
    }

    return this._batteryInfo.tou_settings.schedule.filter(block => block.target === 'peak');
  }

  reserveLevel () {
    return parseInt(this._batteryInfo.backup_reserve_percent);
  }

  siteId () {
    return this._siteId;
  }
}
