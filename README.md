# RoosterX - Movies / Series Manager

RoosterX Designed to work over local network with multiple users and watch lists.
All users download thier media (movies / series) to the same network drive.
The entire drive is scanned on a timley interval and gets cataloged with the help of out side API.

You will have to get an API key from [OMDb API](http://www.omdbapi.com/)
 in order that RoosterX will work properly.

> [OMDb API](http://www.omdbapi.com/) can cost if you have large amount of media. (I don't get any kickback from it, just the first api i found with movies data.
> In the future I may add more providers except OMDB and I'm open for suggestions.

so to make it work on your computer you can build it from dev file or download a compiled version from the Here: (link in near future)


To run it:

```js
$ npm install
$ npm start
```

to build an executable for stand alone install
```js
$ npm builder:dist
```