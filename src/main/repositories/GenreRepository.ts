import {Service} from "typedi";
import {Connection} from "typeorm";
import {InjectConnection} from "typeorm-typedi-extensions";
import {Genre} from "../../entity/Genre";

@Service()
export class GenreRepository {

    @InjectConnection("reading")
    private connection: Connection;

    public getAllGenres() {
        const userRepo = this.connection.manager.getRepository(Genre);
        return userRepo.find();
    }
}
