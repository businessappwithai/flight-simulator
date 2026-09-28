/**
 * A small hand-assembled sample in OurAirports' exact `airports.csv` / `runways.csv` layout, bundled so the simulator
 * worker and tests have airports without downloading the full dataset. Reference points, elevations and runway
 * lengths/headings are approximate; runway thresholds are blank (synthesized by `runwayGeometry`). `XX01` is fictional.
 * For worldwide coverage load the real public-domain files: https://ourairports.com/data/
 */
export const SAMPLE_AIRPORTS_CSV = `"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"
1,"VOMM","large_airport","Chennai International Airport",12.990005,80.169296,52,"AS","IN","IN-TN","Chennai","yes","VOMM","MAA","VOMM","","","",""
2,"VIDP","large_airport","Indira Gandhi International Airport",28.5665,77.103104,777,"AS","IN","IN-DL","New Delhi","yes","VIDP","DEL","VIDP","","","",""
3,"VABB","large_airport","Chhatrapati Shivaji Maharaj International Airport",19.088699,72.867897,39,"AS","IN","IN-MM","Mumbai","yes","VABB","BOM","VABB","","","",""
4,"VAAH","large_airport","Sardar Vallabhbhai Patel International Airport",23.0772,72.634697,189,"AS","IN","IN-GJ","Ahmedabad","yes","VAAH","AMD","VAAH","","","",""
5,"VOBL","large_airport","Kempegowda International Airport",13.1979,77.706299,3000,"AS","IN","IN-KA","Bangalore","yes","VOBL","BLR","VOBL","","","",""
6,"VOHS","large_airport","Rajiv Gandhi International Airport",17.231318,78.429855,2024,"AS","IN","IN-TG","Hyderabad","yes","VOHS","HYD","VOHS","","","",""
7,"VECC","large_airport","Netaji Subhas Chandra Bose International Airport",22.654699,88.446701,16,"AS","IN","IN-WB","Kolkata","yes","VECC","CCU","VECC","","","",""
8,"VANP","large_airport","Dr. Babasaheb Ambedkar International Airport",21.092199,79.047203,1033,"AS","IN","IN-MH","Nagpur","yes","VANP","NAG","VANP","","","",""
9,"XX01","small_airport","Sample Grass Strip (fictional)",23.2875,77.337402,1711,"AS","IN","IN-MP","","no","","","","","","",""
10,"EGLL","large_airport","London Heathrow Airport",51.4706,-0.461941,83,"EU","GB","GB-ENG","London","yes","EGLL","LHR","EGLL","","","",""
11,"KJFK","large_airport","John F Kennedy International Airport",40.639447,-73.779317,13,"NA","US","US-NY","New York","yes","KJFK","JFK","KJFK","JFK","","",""
12,"NZAA","large_airport","Auckland International Airport",-37.008099,174.792007,23,"OC","NZ","NZ-AUK","Auckland","yes","NZAA","AKL","NZAA","","","",""
13,"VNKT","large_airport","Tribhuvan International Airport",27.6966,85.3591,4390,"AS","NP","NP-BA","Kathmandu","yes","VNKT","KTM","VNKT","","","",""
`;
export const SAMPLE_RUNWAYS_CSV = `"id","airport_ref","airport_ident","length_ft","width_ft","surface","lighted","closed","le_ident","le_latitude_deg","le_longitude_deg","le_elevation_ft","le_heading_degT","le_displaced_threshold_ft","he_ident","he_latitude_deg","he_longitude_deg","he_elevation_ft","he_heading_degT","he_displaced_threshold_ft"
101,1,"VOMM",12001,150,"ASP",1,0,"07",,,,72,,"25",,,,252,
102,1,"VOMM",9482,150,"ASP",1,0,"12",,,,121,,"30",,,,301,
201,2,"VIDP",14534,197,"ASP",1,0,"11",,,,106,,"29",,,,286,
202,2,"VIDP",12500,150,"ASP",1,0,"10",,,,97,,"28",,,,277,
203,2,"VIDP",9229,150,"ASP",1,0,"09",,,,88,,"27",,,,268,
301,3,"VABB",11302,197,"ASP",1,0,"09",,,,88,,"27",,,,268,
302,3,"VABB",9419,150,"ASP",1,0,"14",,,,137,,"32",,,,317,
401,4,"VAAH",11499,148,"ASP",1,0,"05",,,,48,,"23",,,,228,
501,5,"VOBL",13123,148,"ASP",1,0,"09L",,,,88,,"27R",,,,268,
502,5,"VOBL",13123,148,"ASP",1,0,"09R",,,,88,,"27L",,,,268,
601,6,"VOHS",13976,197,"ASP",1,0,"09L",,,,88,,"27R",,,,268,
701,7,"VECC",11900,150,"ASP",1,0,"01R",,,,11,,"19L",,,,191,
801,8,"VANP",10500,150,"ASP",1,0,"14",,,,142,,"32",,,,322,
901,9,"XX01",2500,60,"GRS",0,0,"12",,,,,,"30",,,,,
1001,10,"EGLL",12799,164,"ASP",1,0,"09L",,,,90,,"27R",,,,270,
1002,10,"EGLL",12008,164,"ASP",1,0,"09R",,,,90,,"27L",,,,270,
1101,11,"KJFK",14511,200,"ASP",1,0,"04L",,,,31,,"22R",,,,211,
1201,12,"NZAA",11926,148,"ASP",1,0,"05R",,,,52,,"23L",,,,232,
1301,13,"VNKT",10007,148,"ASP",1,0,"02",,,,16,,"20",,,,196,
`;
